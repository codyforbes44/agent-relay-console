# Remove Paddle completely

Strip the card-checkout integration end to end. Credits are sold directly by Agent Relay Console, settled in USDC over the existing x402 rail (agents) or by invoice on request (humans). No card processor, no Merchant-of-Record language anywhere.

## What changes for you

- The "Buy credits" page keeps the credit packs, but instead of opening a card overlay each pack shows the USDC price and the exact x402 top-up call, plus a contact link for invoice payment.
- The orange "test mode" payments banner disappears.
- Terms, Privacy, Refunds, Pricing and the footer stop naming a reseller and say Agent Relay Console sells directly, settled in USDC.
- Nothing about the agent API, credit balances, metering, or existing credit ledger entries changes.

## Code removal

Delete:

- `src/lib/paddle.ts`, `src/lib/paddle.server.ts`
- `src/hooks/usePaddleCheckout.ts`
- `src/utils/payments.functions.ts` (only holds `resolvePaddlePrice`)
- `src/components/PaymentTestModeBanner.tsx`
- `src/routes/api/public/payments/webhook.ts` (and the now-empty `payments` folder)

Uninstall `@paddle/paddle-node-sdk`.

## Rewrites

- `src/routes/_authenticated/billing.tsx` — drop the checkout hook and banner. Each pack renders its USD/USDC amount and a copyable `POST /api/public/v1/credits/purchase` x402 example for that credit amount; add a "Pay by invoice" mailto/contact CTA. Balance card and unlimited-org handling stay as-is.
- `src/lib/billing/packs.ts` — keep packs and pricing math; reword `priceId` usage as a plain pack id in comments (no rename of the string values, they are referenced in docs/pricing copy).
- Legal/marketing copy in `src/routes/terms.tsx`, `privacy.tsx`, `refunds.tsx`, `pricing.tsx`, `index.tsx`, `src/components/LegalFooter.tsx`:
  - Seller is Agent Relay Console; we are the direct seller and handle our own support, billing and refunds.
  - Payments are settled in USDC on Base via x402, or by invoice for larger purchases. No card-processor references, no `paddle.net`, no buyer-terms link.
  - Refunds: keep the 30-day money-back guarantee, requests go to our support contact; refunds returned in USDC to the paying address (or by invoice credit).
  - Privacy: replace the Merchant-of-Record recipient with on-chain settlement data plus our own billing records.
  - Pricing FAQ: swap the MoR question for "How do I pay?" describing x402/USDC and invoicing.

## Verification

- `rg -i paddle` returns no hits outside the lockfile.
- Typecheck passes; `/billing`, `/pricing`, `/terms`, `/privacy`, `/refunds` render without console errors.
- `scripts/check-api-consistency.mjs` still passes.

Note: with no card processor the app cannot take card payments; card checkout would need a new provider integration later.
