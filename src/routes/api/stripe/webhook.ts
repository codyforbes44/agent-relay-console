import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

import {
  findSessionByPaymentIntent,
  listChargeRefunds,
  verifyWebhookEvent,
} from "@/lib/api/stripe.server";

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

/**
 * Claws back credits for a refunded card purchase. Each Stripe refund is
 * written once, keyed by (source, external_ref) = ('stripe', refund.id), so
 * webhook replays and repeated charge.refunded events (e.g. a second partial
 * refund) never double-deduct. Partial refunds remove a proportional share of
 * the purchased credits. The balance may go negative when credits were
 * already spent — that is intentional: the workspace owes the difference.
 */
async function handleChargeRefunded(charge: Stripe.Charge): Promise<Response> {
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) {
    log("stripe_refund_no_intent", { chargeId: charge.id });
    return Response.json({ received: true, ignored: "no payment intent" });
  }

  const session = await findSessionByPaymentIntent(paymentIntentId);
  if (!session) {
    // Not a Checkout purchase we know how to attribute; acknowledge and log.
    log("stripe_refund_no_session", { chargeId: charge.id, paymentIntentId });
    return Response.json({ received: true, ignored: "no session for payment intent" });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: purchase } = await supabaseAdmin
    .from("credit_purchases")
    .select("org_id, user_id, credits, amount_cents")
    .eq("transaction_id", session.id)
    .maybeSingle();

  if (!purchase) {
    log("stripe_refund_no_purchase", { chargeId: charge.id, sessionId: session.id });
    return Response.json({ received: true, ignored: "no recorded purchase" });
  }

  const chargedCents = purchase.amount_cents ?? charge.amount;
  const refunds = await listChargeRefunds(charge.id);
  let clawedBack = 0;

  for (const refund of refunds) {
    if (refund.status !== "succeeded") continue;
    const creditsToRemove = Math.min(
      purchase.credits,
      Math.round((purchase.credits * refund.amount) / Math.max(chargedCents, 1)),
    );
    if (creditsToRemove <= 0) continue;

    const { error } = await supabaseAdmin.from("credit_ledger").insert({
      org_id: purchase.org_id,
      delta: -creditsToRemove,
      kind: "refund",
      source: "stripe",
      external_ref: refund.id,
      description: `Card refund — ${creditsToRemove.toLocaleString()} credits removed (${session.id})`,
    });
    // Unique violation = this refund was already clawed back; skip silently.
    if (error) {
      if (!error.message.includes("duplicate key")) {
        log("stripe_refund_ledger_failed", { refundId: refund.id, message: error.message });
        return Response.json({ error: "ledger write failed" }, { status: 500 });
      }
      continue;
    }

    clawedBack += creditsToRemove;
    await supabaseAdmin.from("audit_logs").insert({
      org_id: purchase.org_id,
      user_id: purchase.user_id,
      action: "credits.refunded",
      payload: {
        source: "stripe",
        sessionId: session.id,
        refundId: refund.id,
        amountCents: refund.amount,
        creditsRemoved: creditsToRemove,
      },
    });
  }

  log("stripe_refund_processed", {
    chargeId: charge.id,
    sessionId: session.id,
    orgId: purchase.org_id,
    creditsRemoved: clawedBack,
  });
  return Response.json({ received: true, creditsRemoved: clawedBack });
}

/**
 * Stripe webhook: turns a completed Checkout Session into ledger credits.
 *
 * Idempotent the same way x402 settlement is: the credit is written with
 * (source, external_ref) = ('stripe', session.id), which the ledger's unique
 * index enforces — a replayed event can never credit twice.
 */
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("stripe-signature");
        if (!signature) return Response.json({ error: "missing signature" }, { status: 400 });

        const rawBody = await request.text();

        let event: Stripe.Event;
        try {
          event = verifyWebhookEvent(rawBody, signature);
        } catch (e) {
          log("stripe_webhook_bad_signature", {
            message: e instanceof Error ? e.message : String(e),
          });
          return Response.json({ error: "invalid signature" }, { status: 400 });
        }

        if (event.type === "charge.refunded") {
          return handleChargeRefunded(event.data.object);
        }

        if (event.type !== "checkout.session.completed") {
          return Response.json({ received: true, ignored: event.type });
        }

        const session = event.data.object;
        const orgId = session.metadata?.["orgId"];
        const userId = session.metadata?.["userId"] ?? null;
        const packId = session.metadata?.["packId"] ?? "unknown";
        const credits = Number.parseInt(session.metadata?.["credits"] ?? "", 10);

        if (!orgId || !Number.isFinite(credits) || credits <= 0) {
          // Not one of our sessions (or corrupted metadata). Acknowledge so
          // Stripe stops retrying, but log loudly for the operator.
          log("stripe_webhook_bad_metadata", { sessionId: session.id, metadata: session.metadata });
          return Response.json({ received: true, ignored: "bad metadata" });
        }

        if (session.payment_status !== "paid") {
          // Async payment methods complete later via checkout.session.async_payment_succeeded;
          // card payments are always "paid" here.
          return Response.json({ received: true, ignored: "not paid yet" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const environment = event.livemode ? "live" : "test";

        const { error: ledgerError } = await supabaseAdmin.from("credit_ledger").insert({
          org_id: orgId,
          delta: credits,
          kind: "topup",
          source: "stripe",
          external_ref: session.id,
          description: `Card purchase — ${credits.toLocaleString()} credits (${packId})`,
        });

        // Unique violation on (source, external_ref) means this session was
        // already credited: a webhook retry, still a success.
        const credited = !ledgerError;
        if (ledgerError && !ledgerError.message.includes("duplicate key")) {
          // A real write failure must return 5xx so Stripe retries.
          log("stripe_webhook_ledger_failed", {
            sessionId: session.id,
            message: ledgerError.message,
          });
          return Response.json({ error: "ledger write failed" }, { status: 500 });
        }

        if (credited) {
          await supabaseAdmin.from("credit_purchases").insert({
            org_id: orgId,
            user_id: userId,
            transaction_id: session.id,
            environment,
            price_id: packId,
            credits,
            amount_cents: session.amount_total,
            currency: session.currency,
          });
          await supabaseAdmin.from("audit_logs").insert({
            org_id: orgId,
            user_id: userId,
            action: "credits.purchased",
            payload: {
              source: "stripe",
              sessionId: session.id,
              packId,
              credits,
              amountCents: session.amount_total,
              environment,
            },
          });
          log("stripe_purchase_credited", {
            sessionId: session.id,
            orgId,
            credits,
            amountCents: session.amount_total,
            environment,
          });
        } else {
          log("stripe_webhook_replay", { sessionId: session.id, orgId });
        }

        return Response.json({ received: true, credited });
      },
    },
  },
});
