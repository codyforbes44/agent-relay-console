# Harden the money path: atomic reserve-and-debit

Your review is accurate — I verified each finding against the code and database. The unifying diagnosis holds: authorization is check-then-atomically-claim, money is check-then-hope. This plan fixes that, in severity order.

One correction to your open question: the payment crediting path is already safe. `credit_ledger` has a unique partial index on `(source, external_ref)`, and `creditSettledPayment` treats a unique violation as success, so a settled tx cannot be credited twice. `payment_intents.nonce` is also unique. No change needed there.

## 1. Atomic credit reservation (fixes findings 1 and 2)

New Postgres function `reserve_credits(_org_id, _key_id, _tool_name, _credits, _request_id, _latency_ms, _max_per_call, _daily_cap, _total_cap)`:
- Takes a per-org advisory lock, re-reads the ledger balance inside the same transaction, and returns `insufficient` with the current balance when it's short.
- Evaluates the key's owner-set spend guardrails in the same transaction: per-call, rolling-24h and lifetime caps are computed from `usage_events` under the lock and return a `budget_exceeded` variant with `{ spent, required, limit, window }`. This removes the same TOCTOU shape the balance check had — `checkKeyGuardrails` keeps only the non-monetary checks (expiry, allowed tools), which are not racy.
- Otherwise inserts the `usage_events` row and the matching `credit_ledger` debit in one transaction, returning the usage event id and the post-debit balance.
- Unlimited workspaces skip the debit but still get the usage event.

Companion `refund_reserved_credits(_usage_event_id, _reason)`: inserts a compensating positive ledger entry and marks the usage event `error`, used when the tool throws after reservation.

Route changes in `src/routes/api/public/v1/tools.$toolName.ts`:
- Replace `getBalance()` → run → `recordUsage()` with: reserve *before* `runTool`, then on success only patch latency/status; on throw, call the refund.
- The 402 path stays: reservation returning `insufficient` supplies the authoritative balance for the offer, and after an x402 settlement we retry the reservation once instead of re-reading the balance.
- The success payload reports the balance the RPC returned, not `balance - credits` (fixes the cosmetic drift nit).
- `recordUsage` keeps its existing role for zero-credit rejection/audit rows only, and stops failing silently: an insert error is logged as a structured `metering_write_failed` event.

## 2. Confirmed side-effect double-execution (finding 3)

`redeemConfirmation`: a row that is `redeemed` with a null stored response now returns a `409 request_in_progress` failure instead of `ok: true, replay: null`. The agent requests a fresh preview rather than risking a second send. Documented in the API error table.

## 3. Atomic signup quota (finding 4)

New `consume_signup_quota(_ip_hash, _max, _window_hours)` RPC doing `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`, summing the rolling window inside the same statement chain. `consumeSignupQuota` becomes a single RPC call.

On the header question: the app is served through Cloudflare, so `cf-connecting-ip` is present and authoritative. I'll reorder `clientIp` to prefer `cf-connecting-ip` and only fall back to the spoofable headers when a `TRUST_FORWARDED_IP` flag is set, so an unfronted deploy fails closed to a single shared bucket rather than free-for-all.

## 4. Idempotency TTL (finding 5)

Add `expires_at` to `api_idempotency` plus an index. A claim whose `response` is still null and is older than 5 minutes is reclaimable — the insert-conflict branch deletes and re-claims it instead of returning a permanent 409. Completed rows carry a 24h expiry and are purged opportunistically.

## 5. Nits (finding 6)

- Rejection sampling in `randomString` / `randomToken` to remove modulo bias.
- `toAtomic` uses `BigInt(Math.round(usd * 100)) * 10_000n`.
- `getBalance` returns a structured error instead of throwing raw.
- `readBearer`: keep the `x-api-key` fallback and document it in the discovery doc and `/docs` auth section.

## Technical notes

- Two migrations: one for the three RPCs (`reserve_credits`, `refund_reserved_credits`, `consume_signup_quota`), one for the `api_idempotency.expires_at` column and index. All functions are `security definer` with `set search_path = public`, granted to `service_role` only.
- Touched files: `src/lib/api/metering.server.ts`, `src/lib/api/confirmations.server.ts`, `src/lib/api/signup.server.ts`, `src/lib/api/keys.server.ts`, `src/lib/api/x402.server.ts`, `src/routes/api/public/v1/tools.$toolName.ts`, `src/lib/mcp/runtime.ts` (same reservation path), plus docs.
- Verification: a concurrency test firing N parallel invocations against a 1-credit workspace, asserting exactly one success and a non-negative ending balance; plus a token-reuse test asserting the second in-flight redeem returns 409.
