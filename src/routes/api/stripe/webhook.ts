import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

import { verifyWebhookEvent } from "@/lib/api/stripe.server";

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
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
