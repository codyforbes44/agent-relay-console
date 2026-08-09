# Agent-Native Payments for RELAY — review and recommendation

## Where RELAY stands today (verified in code)

- **Prepaid credits only.** `credit_ledger` holds grants, usage debits and top-ups; `org_credit_balance` sums it. New workspaces get 500 free credits on creation.
- **Metered per call.** `metering.server.ts` writes a `usage_events` row plus a negative ledger entry per billable tool call; responses carry `x-credits-charged`.
- **402 already exists — but it is a dead end for an agent.** `tools.$toolName.ts` returns `402 insufficient_credits` with no machine-payable path attached. The agent's only remedy is `POST /claim` → a human signs in → Paddle overlay.
- **Checkout is human-only.** Paddle credit packs ($9 / $39 / $149) via a browser overlay in `billing.tsx`. Paddle is Merchant of Record and has no agent-callable purchase API for this flow.
- **Identity exists, spend control does not.** Bearer keys are hashed with scopes and rotation, but there is no per-key budget, no daily cap, no expiry, no allowlist.

**The gap:** RELAY's pitch is "agents onboard themselves," yet the moment credits run out an agent must find a human. Every rail in your brief exists to remove exactly that stop.

## Recommendation

Pick the one rail that is shippable today and standards-aligned: **x402 over USDC**, keeping Paddle for humans.

Reading of the landscape:

- **x402 / HTTP 402 + stablecoin (Coinbase, Base) — build this.** It is an open spec, it is already how RELAY signals "insufficient credits," and it needs no agent onboarding, no card, no KYC on the agent side. Settlement is seconds; sub-cent amounts work, which matches 1–10 credit tool calls.
- **Stripe SPT / ACP, Mastercard AP4M, Google AP2 — do not build yet.** These are card-network programs in limited or announced availability, and RELAY cannot mint or accept SPTs through the Lovable-managed Paddle integration. Design the payment layer so a second rail can be added, then wait for GA.
- **Skyfire / KYA — adopt the idea, not the vendor, now.** The valuable part is a verifiable claim that "this agent acts for this principal, under these limits." RELAY can issue that itself from `agent_keys` today and federate later.
- **Rye / universal checkout — out of scope.** RELAY is the merchant, not the buyer.

The strategic point: RELAY's differentiator is being *payable by a machine*, not just callable by one. Spend controls are half the product — a merchant that lets an agent pay is useless if the agent's owner cannot bound the damage.

## Phase 1 — Machine-payable 402 (the core)

1. **Wallet + facilitator.** Register a receiving USDC address on Base and use a hosted x402 facilitator to verify and settle payments. Requires two secrets (receiving address, facilitator key). No private key ever lives in RELAY.
2. **Make 402 actionable.** When credits are exhausted, return 402 with an `x402`-shaped body and `WWW-Authenticate`-style challenge: accepted asset (USDC), network (Base), amount for this call, pay-to address, and a nonce tied to the request.
3. **Retry with proof.** The agent resends the identical request with an `X-Payment` header carrying the signed payment payload. RELAY verifies via the facilitator, credits the ledger (`kind: 'topup'`, source `x402`), executes the tool, and returns `x-credits-charged` as usual. Idempotency keys already in place prevent double execution; the payment nonce prevents double credit.
4. **Top-up endpoint.** `POST /api/public/v1/credits/topup` so an agent can buy a block of credits proactively instead of paying per call.
5. **Advertise it.** Add the rail to `/llms.txt`, the agent manifest, OpenAPI, the error table (402 becomes "retryable after payment") and docs, with a worked example.

## Phase 2 — Guardrails (Know Your Agent, RELAY-side)

1. **Per-key spend controls** on `agent_keys`: max credits per call, daily cap, absolute cap, expiry, allowed tool list. Enforced in the same place rate limiting is, before the tool runs; violations return a distinct 403 code so the agent can tell "forbidden" from "out of budget."
2. **Console UI** for the human owner to set those limits at key creation and edit them later, plus a live spend chart per key.
3. **Signed agent identity.** Issue a short-lived JWT per key asserting org, key id, scopes and limits, so downstream services can verify the caller is a bounded, claimed agent. This is RELAY's own KYA; federating with an external registry stays optional.
4. **Auto top-up.** Optional setting: when balance drops below N, pull one credit pack automatically from the x402 wallet, capped by the key's budget.

## Phase 3 — Optional second rail

Abstract payment behind a provider interface in Phase 1 so adding Stripe SPT/ACP later is a new adapter, not a rewrite. Revisit when SPT is generally available and Paddle-compatible; note that accepting a second Merchant of Record has tax and reconciliation consequences that need a decision at that time.

## Technical notes

- New tables: `payment_intents` (nonce, amount, asset, network, status, request id) and a `source` column on ledger top-ups; new columns on `agent_keys` for the spend limits.
- Payment verification runs in the existing public route handler with the service-role client, never in the browser. Secrets are read inside the handler.
- Paddle stays exactly as-is for human purchases; the legal pages already name Agent Relay Console as seller. Crypto top-ups sit outside Paddle's Merchant-of-Record scope, so the terms and refund pages need a short section covering non-refundable on-chain credit purchases.
- The consistency check script gains assertions for the new endpoint, error codes and docs section.

## What I need from you

- Confirm USDC-on-Base via a hosted facilitator is acceptable, or name a preferred chain/asset.
- Confirm whether Phase 2 guardrails ship with Phase 1 (recommended — they are what make the rail safe to advertise) or follow after.
