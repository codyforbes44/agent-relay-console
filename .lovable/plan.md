# Verify Stripe Checkout credits purchase, end to end (test mode)

## What I found first

The full card-payment path is already implemented:

- `src/lib/billing/checkout.functions.ts` — authenticated server function that checks workspace access, resolves the pack, and builds success/cancel URLs from the request origin.
- `src/lib/api/stripe.server.ts` — creates the hosted Checkout Session with `orgId`, `userId`, `packId`, `credits` in session metadata; verifies webhook signatures.
- `src/routes/api/stripe/webhook.ts` — credits the ledger on `checkout.session.completed`, records the purchase, writes an audit log, and claws credits back on `charge.refunded`.
- `src/routes/_authenticated/billing.tsx` — pack buttons, `?checkout=success|cancel` banner, balance polling every 15s.
- Database is ready: `credit_purchases` exists, and `idx_credit_ledger_external_ref` is a unique index on `(source, external_ref)`, which is what makes webhook replays safe.

**Blocker:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are not configured in this project. Because of that, `stripeConfigured()` returns false, `isCardCheckoutEnabled` reports false, the billing page hides the card packs, and no checkout session can be created. So no live end-to-end run is possible yet, and `credit_ledger` currently contains zero rows with `source = 'stripe'` — the flow has never actually run.

## Decision needed before testing

Two ways to get test keys in place:

1. **Keep the current bring-your-own-key setup.** You paste a Stripe test secret key and a webhook signing secret from your own Stripe account. No code changes — everything above already expects these two variables. Fastest path to a green end-to-end test.
2. **Switch to Lovable's built-in Stripe payments.** No Stripe account needed and Lovable handles compliance, but the current checkout/webhook code would be rewritten against the managed integration, and the x402/USDC rail and refund clawback logic would need reworking around it.

This plan assumes option 1 unless you say otherwise.

## Verification plan

### 1. Configure test credentials

- Add `STRIPE_SECRET_KEY` (test-mode `sk_test_...`) as a project secret.
- Register a webhook endpoint in the Stripe test dashboard pointing at the stable preview URL `https://project--bcb8aa89-c5d8-49f9-ae4d-7c250103809e-dev.lovable.app/api/stripe/webhook`, subscribed to `checkout.session.completed` and `charge.refunded`.
- Add the resulting signing secret as `STRIPE_WEBHOOK_SECRET`.

Note: `/api/stripe/webhook` is not under `/api/public/`, so confirm it is reachable unauthenticated on the deployed URL. If it is gated, move it to `src/routes/api/public/stripe/webhook.ts` and update the Stripe endpoint URL. Signature verification stays the security boundary either way.

### 2. Automated checks that need no Stripe account

- Run the existing `tests/stripe-webhook.test.ts` suite.
- Add cases if missing: bad signature returns 400, missing signature returns 400, unknown event type is acknowledged and ignored, `payment_status != 'paid'` does not credit, corrupted metadata is acknowledged without crediting, and a replayed `checkout.session.completed` credits exactly once.

### 3. Live test-mode run

- Sign in, open `/billing`, confirm the card packs now render.
- Click a pack; confirm redirect to Stripe Checkout with the correct USD amount and pack name.
- Pay with test card `4242 4242 4242 4242`.
- Confirm redirect back to `/billing?checkout=success` and that the success banner shows.
- Confirm the balance increases within the 15s poll window.

### 4. Confirm server-side state

Query the database and logs to prove the credit came from the webhook, not the redirect:

- `credit_ledger` has one row with `source='stripe'`, `kind='topup'`, `external_ref = <session id>`, and the correct positive `delta`.
- `credit_purchases` has a matching row with `environment='test'` and the right `credits`/`amount_cents`.
- `audit_logs` has a `credits.purchased` entry.
- Server logs show `stripe_purchase_credited`.

### 5. Negative and edge paths

- **Cancel:** start checkout, back out; confirm `/billing?checkout=cancel` banner and no ledger row.
- **Replay:** resend the same `checkout.session.completed` from the Stripe dashboard; confirm the response reports `credited: false`, the log shows `stripe_webhook_replay`, and the balance is unchanged.
- **Full refund:** refund the test payment in Stripe; confirm a negative `credit_ledger` row keyed to the refund id, a `credits.refunded` audit entry, and a reduced balance.
- **Partial refund:** refund half; confirm proportional clawback and that a second `charge.refunded` delivery does not double-deduct.
- **Access control:** confirm `createCreditCheckout` rejects an `orgId` the signed-in user does not belong to.

### 6. Report

Summarize each step as pass/fail with the evidence — ledger rows, audit entries, log lines, and screenshots of the redirect and banner. Fix anything that fails and re-run the affected step.

## Technical notes

- The webhook is the only thing that grants credits; the success redirect is cosmetic. Any test that only checks the redirect is not a real verification.
- Idempotency relies entirely on the unique `(source, external_ref)` index plus the handler treating a duplicate-key error as success. A non-duplicate write failure returns 500 so Stripe retries — worth confirming that branch is not accidentally swallowing real errors.
- Refund clawback can drive a balance negative when credits were already spent. That is intended; confirm the UI renders a negative balance sensibly rather than crashing.
