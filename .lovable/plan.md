# Harden the money path: atomic reserve-and-debit

Your review is accurate — I verified each finding against the code and database. The unifying diagnosis holds: authorization is check-then-atomically-claim, money is check-then-hope. This plan fixes that, in severity order.

One correction to your open question: the payment crediting path is already safe. `credit_ledger` has a unique partial index on `(source, external_ref)`, and `creditSettledPayment` treats a unique violation as success, so a settled tx cannot be credited twice. `payment_intents.nonce` is also unique. No change needed there — though the `payment_intents` upsert does run unconditionally after a swallowed duplicate, re-stamping `settled`; harmless, and I'll gate it on `credited` while touching the file.

## 0. Catalog drift: prod is current, the stale payload was not

I fetched both surfaces before writing this. `https://3bi.ai/api/public/v1/tools` (anonymous) returns all ten tools with `fetch_url` (2 cr / $0.02), `crawl_site` (6 / $0.06) and `extract_structured` (8 / $0.08) present, the full pricing block (`usdPerCredit`, `packs`, `purchase`, `pricingUrl`), and no `filteredForOrg`. It matches localhost exactly. So the deploy is not behind the code and there is nothing to redeploy — the seven-tool `{unit, freeGrant}` payload was a stale earlier read, not a live surface.

The CI guards are still worth adding, because nothing currently prevents the code from regressing into that shape:

- `scripts/check-api-consistency.mjs` — assert at least one `publicApi && credits > 0` tool exists and every billable tool is serialized with `credits > 0` and a positive `usdPerCall`; assert the top-level `pricing` block carries `unit`, `currency`, `usdPerCredit`, `freeGrant`, non-empty `packs[]`, `purchase` and `pricingUrl`, each failing individually. Not re-asserting name-completeness — `catalogNames === expectedNames` already covers it.
- `package.json` — add `"check:api:prod": "node scripts/check-api-consistency.mjs https://3bi.ai"`, run as a post-deploy smoke step rather than a pre-merge gate, so the deployed surface is guarded as well as the build.
- Serialization order in `catalog()`: billable tools before the zero-credit `sandbox_*` ones, so a cold agent reads the value story first. `PUBLIC_TOOLS` order already puts them first today; the change is an explicit sort so it can't drift.


## 1. Atomic credit reservation (fixes findings 1 and 2)

New Postgres function `reserve_credits(_org_id, _key_id, _tool_name, _credits, _request_id, _latency_ms, _max_per_call, _daily_cap, _total_cap)`:
- Takes a per-org advisory lock, re-reads the ledger balance inside the same transaction, and returns `insufficient` with the current balance when it's short.
- Evaluates the key's owner-set spend guardrails in the same transaction: per-call, rolling-24h and lifetime caps are computed under the lock and return a `budget_exceeded` variant with `{ spent, required, limit, window }`. This removes the same TOCTOU shape the balance check had — `checkKeyGuardrails` keeps only the non-monetary checks (expiry, allowed tools), which are not racy. Your cost note is right: `credit_ledger` has no `key_id`, so the cap aggregate joins ledger → `usage_events` on `key_id`, which is a per-call aggregate over the key's history — cheap but not free. The migration adds `usage_events (key_id, created_at desc)` and an index on `credit_ledger (usage_event_id)` so both the 24h and lifetime variants stay index-only.
- Otherwise inserts the `usage_events` row and the matching `credit_ledger` debit in one transaction, returning the usage event id and the post-debit balance.
- Unlimited workspaces skip the debit but still get the usage event.

Companion `refund_reserved_credits(_usage_event_id, _reason)`: inserts a compensating positive ledger entry and marks the usage event `error`, used when the tool throws after reservation.

Route changes in `src/routes/api/public/v1/tools.$toolName.ts`:
- Replace `getBalance()` → run → `recordUsage()` with: reserve *before* `runTool`, then on success only patch latency/status; on throw, call the refund.
- The 402 path stays: reservation returning `insufficient` supplies the authoritative balance for the offer, and after an x402 settlement we retry the reservation once instead of re-reading the balance.
- The success payload reports the balance the RPC returned, not `balance - credits` (fixes the cosmetic drift nit).
- `recordUsage` keeps its existing role for zero-credit rejection/audit rows only, and stops failing silently: an insert error is logged as a structured `metering_write_failed` event.

## 2. Confirmed side-effect double-execution (finding 3)

`redeemConfirmation`: a row that is `redeemed` with a null stored response now returns a `409 request_in_progress` failure instead of `ok: true, replay: null`. The message tells the agent explicitly what to do — "the approved call is already running or was interrupted; call the tool again with no token to get a fresh preview and token" — so a token bricked by a genuine crash reads as guidance, not a bug. Documented in the API error table.

## 3. Atomic signup quota (finding 4)

New `consume_signup_quota(_ip_hash, _max, _window_hours)` RPC doing `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`, summing the rolling window inside the same statement chain. `consumeSignupQuota` becomes a single RPC call.

On the header question: the app is served through Cloudflare, so `cf-connecting-ip` is present and authoritative. I'll reorder `clientIp` to prefer `cf-connecting-ip` and only fall back to the spoofable headers when a `TRUST_FORWARDED_IP` flag is set, so an unfronted deploy fails closed to a single shared bucket rather than free-for-all.

## 4. Idempotency retention — no reclaim (finding 5)

No time-based reclaim of in-flight claims. Reclaiming assumes the original call is dead, and nothing in the code bounds end-to-end tool execution — `tools.server.ts` has only a per-fetch timeout. (I'm not asserting any specific tool exceeds five minutes; the point is that no bound exists, so any threshold races the clock.) Option (b): a null-response claim keeps returning `409 request_in_progress`, with the message extended to "if the original request is known to have failed, retry with a new idempotency-key." That removes the race outright instead of tuning it.

Retention only: add `expires_at` to `api_idempotency` (24h from completion) plus an index, and purge expired completed rows opportunistically so the JSONB responses don't grow unbounded. A hard end-to-end deadline on `runTool` is a sensible follow-up, and a reclaim threshold strictly above it can be revisited then — not in this change.

## 5. Nits (finding 6)

- Rejection sampling in `randomString` / `randomToken` to remove modulo bias.
- `toAtomic` uses `BigInt(Math.round(usd * 100)) * 10_000n`.
- `getBalance` returns a structured error instead of throwing raw.
- `readBearer`: keep the `x-api-key` fallback and document it in the discovery doc and `/docs` auth section.

## Technical notes

- Two migrations: one for the three RPCs (`reserve_credits`, `refund_reserved_credits`, `consume_signup_quota`) plus the two supporting indexes, one for the `api_idempotency.expires_at` column and index. All functions are `security definer` with `set search_path = public`, granted to `service_role` only.
- Touched files: `src/lib/api/metering.server.ts`, `src/lib/api/confirmations.server.ts`, `src/lib/api/signup.server.ts`, `src/lib/api/keys.server.ts`, `src/lib/api/payments.server.ts`, `src/lib/api/x402.server.ts`, `src/lib/api/catalog.server.ts`, `src/routes/api/public/v1/tools.$toolName.ts`, `src/lib/mcp/runtime.ts` (same `getBalance` → run → `recordUsage` pattern, so it gets the same reservation path), `scripts/check-api-consistency.mjs`, `package.json`, plus docs.
- Verification:
  - Concurrency: N parallel invocations against a 1-credit workspace → exactly one success, ending balance never negative.
  - Rate limit: because `usage_events` is now written at reservation time, in-flight calls are counted — assert that N parallel calls yield at most `RATE_LIMIT_PER_MINUTE` counted in the window, so a future refactor moving the insert back after execution fails the test.
  - Guardrails: parallel calls against a key with a daily cap of one call → exactly one success, the rest `budget_exceeded`.
  - Refund: tool throws after reservation → compensating ledger entry present, usage event marked `error`, balance restored to its pre-call value.
  - x402: settle-then-reserve-retry — an insufficient reservation followed by a settled payment succeeds on the retried reservation and charges exactly once.
  - Confirmations: second redeem of an in-flight token returns 409 with the fresh-preview guidance.
  - Catalog: `npm run check:api` against the local dev server first (confirms the new field names match what the route serializes), then `npm run check:api:prod` against the live origin.
