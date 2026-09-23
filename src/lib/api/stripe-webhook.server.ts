/**
 * Stripe webhook handling, kept out of the route file so it can be unit
 * tested without booting the router.
 *
 * The webhook is the only thing that grants credits — the browser redirect
 * back to /billing is cosmetic. Idempotency comes from the unique index on
 * credit_ledger (source, external_ref): a replayed event can never credit
 * twice, and a duplicate-key error is treated as success.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  findSessionByPaymentIntent,
  getStripeClient,
  listChargeRefunds,
  verifyWebhookEvent,
} from "@/lib/api/stripe.server";
import {
  getSubscriptionByStripeId,
  grantPeriodCredits,
  markSubscriptionCanceled,
  syncSubscriptionFromStripe,
} from "@/lib/api/subscriptions.server";

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

function isDuplicateKey(message: string): boolean {
  return message.includes("duplicate key");
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
      if (!isDuplicateKey(error.message)) {
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

/** Turns a completed Checkout Session into ledger credits, exactly once. */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  livemode: boolean,
): Promise<Response> {
  const orgId = session.metadata?.["orgId"];
  const userId = session.metadata?.["userId"] ?? null;
  const packId = session.metadata?.["packId"] ?? "unknown";
  const credits = Number.parseInt(session.metadata?.["credits"] ?? "", 10);

  if (!orgId || !Number.isFinite(credits) || credits <= 0) {
    // Not one of our sessions (or corrupted metadata). Acknowledge so Stripe
    // stops retrying, but log loudly for the operator.
    log("stripe_webhook_bad_metadata", { sessionId: session.id, metadata: session.metadata });
    return Response.json({ received: true, ignored: "bad metadata" });
  }

  if (session.payment_status !== "paid") {
    // Async payment methods complete later via checkout.session.async_payment_succeeded;
    // card payments are always "paid" here.
    return Response.json({ received: true, ignored: "not paid yet" });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const environment = livemode ? "live" : "test";

  const { error: ledgerError } = await supabaseAdmin.from("credit_ledger").insert({
    org_id: orgId,
    delta: credits,
    kind: "topup",
    source: "stripe",
    external_ref: session.id,
    description: `Card purchase — ${credits.toLocaleString()} credits (${packId})`,
  });

  // Unique violation on (source, external_ref) means this session was already
  // credited: a webhook retry, still a success.
  const credited = !ledgerError;
  if (ledgerError && !isDuplicateKey(ledgerError.message)) {
    // A real write failure must return 5xx so Stripe retries.
    log("stripe_webhook_ledger_failed", { sessionId: session.id, message: ledgerError.message });
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
}

/**
 * Entry point for POST /api/public/stripe/webhook. The signature check is the
 * security boundary — the endpoint itself is unauthenticated by design.
 */
export async function handleStripeWebhook(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing signature" }, { status: 400 });

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = verifyWebhookEvent(rawBody, signature);
  } catch (e) {
    log("stripe_webhook_bad_signature", { message: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  if (event.type === "charge.refunded") {
    return handleChargeRefunded(event.data.object);
  }

  if (event.type === "invoice.payment_succeeded") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return handleInvoicePaid(supabaseAdmin, event.data.object);
  }

  if (event.type === "customer.subscription.updated") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await syncSubscriptionFromStripe(supabaseAdmin, event.data.object);
    return Response.json({ received: true });
  }

  if (event.type === "customer.subscription.deleted") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await markSubscriptionCanceled(supabaseAdmin, event.data.object.id);
    log("stripe_subscription_canceled", { subscriptionId: event.data.object.id });
    return Response.json({ received: true });
  }

  if (event.type !== "checkout.session.completed") {
    return Response.json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  if (session.mode === "subscription") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return handleSubscriptionCheckoutCompleted(supabaseAdmin, session, event.livemode);
  }

  return handleCheckoutCompleted(session, event.livemode);
}

/**
 * Records a new monthly-plan subscription. Credits are NOT granted here —
 * the first invoice's payment_succeeded event (which Stripe sends right
 * after) is the single grant path, so a subscription can never double-grant.
 */
async function handleSubscriptionCheckoutCompleted(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
  livemode: boolean,
): Promise<Response> {
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) {
    log("stripe_sub_no_subscription", { sessionId: session.id });
    return Response.json({ received: true, ignored: "no subscription on session" });
  }

  const sub = await getStripeClient().subscriptions.retrieve(subscriptionId);
  await syncSubscriptionFromStripe(admin, sub);
  log("stripe_subscription_started", {
    sessionId: session.id,
    subscriptionId,
    orgId: session.metadata?.["orgId"],
    planId: session.metadata?.["planId"],
    environment: livemode ? "live" : "test",
  });
  return Response.json({ received: true, subscription: subscriptionId });
}

/**
 * Grants one period's plan credits for a paid subscription invoice.
 * Idempotent on the invoice id — replays credit nothing twice.
 */
async function handleInvoicePaid(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<Response> {
  // Stripe v22: the subscription link lives under invoice.parent.
  const parent = invoice.parent as
    | {
        type?: string;
        subscription_details?: {
          subscription?: string | Stripe.Subscription;
          metadata?: Record<string, string> | null;
        };
      }
    | null
    | undefined;
  const subDetails =
    parent?.type === "subscription_details" ? parent.subscription_details : undefined;
  const subRef = subDetails?.subscription;
  const subscriptionId = typeof subRef === "string" ? subRef : subRef?.id;
  if (!subscriptionId) {
    return Response.json({ received: true, ignored: "not a subscription invoice" });
  }
  if (invoice.status !== "paid") {
    return Response.json({ received: true, ignored: `invoice ${invoice.status}` });
  }

  // Defensive: the subscription row should already exist (checkout completed
  // fires first), but a replayed/out-of-order event must not lose the grant.
  let subscription = await getSubscriptionByStripeId(admin, subscriptionId);
  if (!subscription) {
    const sub = await getStripeClient().subscriptions.retrieve(subscriptionId);
    await syncSubscriptionFromStripe(admin, sub);
    subscription = await getSubscriptionByStripeId(admin, subscriptionId);
  }
  if (!subscription || !subscription.plan) {
    log("stripe_invoice_no_subscription", {
      invoiceId: invoice.id,
      subscriptionId,
    });
    return Response.json({ received: true, ignored: "unknown subscription" });
  }

  const toIso = (sec: number | null | undefined) =>
    sec ? new Date(sec * 1000).toISOString() : null;

  const { granted, credits, rollover } = await grantPeriodCredits(admin, {
    subscription,
    plan: subscription.plan,
    invoice: {
      id: invoice.id,
      periodStart: toIso(invoice.period_start),
      periodEnd: toIso(invoice.period_end),
    },
  });

  log("stripe_subscription_credited", {
    invoiceId: invoice.id,
    subscriptionId,
    orgId: subscription.orgId,
    planId: subscription.planId,
    granted,
    credits,
    rollover,
  });
  return Response.json({ received: true, granted, credits, rollover });
}
