/**
 * Stripe card checkout: the human-facing payment rail. Machine buyers still
 * settle in USDC over x402 (@/lib/api/payments.server) — this is the second
 * rail, for people who want to pay with a card.
 *
 * Env is read at call time (never at module scope), same convention as
 * x402Config, because the Worker runtime injects it per request.
 */
import Stripe from "stripe";

let _stripe: Stripe | undefined;

export function stripeConfigured(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"]?.trim());
}

function stripeClient(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"]?.trim();
  if (!key) throw new Error("Stripe is not configured (missing STRIPE_SECRET_KEY)");
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

export type CheckoutSession = { id: string; url: string };

/** Creates a hosted Checkout Session for one credit pack, in USD. */
export async function createPackCheckoutSession(input: {
  pack: { priceId: string; credits: number; amountCents: number; label: string };
  orgId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  const stripe = stripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: input.orgId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.pack.amountCents,
          product_data: {
            name: `${input.pack.label} — ${input.pack.credits.toLocaleString()} RELAY credits`,
          },
        },
      },
    ],
    // The webhook trusts only this metadata, never the client, to decide
    // which org gets credited and how much.
    metadata: {
      orgId: input.orgId,
      userId: input.userId,
      packId: input.pack.priceId,
      credits: String(input.pack.credits),
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { id: session.id, url: session.url };
}

/** Verifies the `stripe-signature` header against the raw request body. Throws on failure. */
export function verifyWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"]?.trim();
  if (!secret) throw new Error("Stripe webhook secret is not configured");
  return stripeClient().webhooks.constructEvent(rawBody, signature, secret);
}

/** Resolves the Checkout Session a payment intent belongs to, for refund handling. */
export async function findSessionByPaymentIntent(
  paymentIntentId: string,
): Promise<Stripe.Checkout.Session | null> {
  const sessions = await stripeClient().checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 1,
  });
  return sessions.data[0] ?? null;
}

/** Lists the individual refunds on a charge (each is clawed back once, by refund id). */
export async function listChargeRefunds(chargeId: string): Promise<Stripe.Refund[]> {
  const refunds = await stripeClient().refunds.list({ charge: chargeId, limit: 100 });
  return refunds.data;
}
