/**
 * Monthly subscription plans: Stripe Checkout (subscription mode), the
 * customer portal, and the per-period credit grants with rollover.
 *
 * Money flow:
 * - checkout.session.completed (mode=subscription) → records the
 *   org_subscriptions row. It does NOT grant credits.
 * - invoice.payment_succeeded → the ONLY grant path. Grants
 *   plan.monthlyCredits plus rollover of the previous period's unused
 *   subscription credits (capped at the plan's rolloverCap). Idempotent on
 *   the Stripe invoice id via the ledger's unique (source, external_ref).
 * - customer.subscription.updated → syncs status / period / plan.
 * - customer.subscription.deleted → marks the row canceled; grants stop.
 *
 * Rollover accounting assumes subscription credits are consumed first
 * (FIFO): unused = last period's grant − org-wide spend since that grant.
 * Pack credits never expire and are unaffected by this math.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { getStripeClient, stripeConfigured } from "@/lib/api/stripe.server";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  PLAN_BY_ID,
  type RelayPlan,
} from "@/lib/billing/plans";

export type OrgSubscription = {
  id: string;
  orgId: string;
  planId: string;
  plan: RelayPlan | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

function rowToSubscription(row: Record<string, unknown>): OrgSubscription {
  const planId = String(row["plan_id"]);
  return {
    id: String(row["id"]),
    orgId: String(row["org_id"]),
    planId,
    plan: PLAN_BY_ID[planId] ?? null,
    stripeCustomerId: String(row["stripe_customer_id"]),
    stripeSubscriptionId: String(row["stripe_subscription_id"]),
    status: String(row["status"]),
    currentPeriodStart: row["current_period_start"]
      ? String(row["current_period_start"])
      : null,
    currentPeriodEnd: row["current_period_end"] ? String(row["current_period_end"]) : null,
    cancelAtPeriodEnd: row["cancel_at_period_end"] === true,
  };
}

/** The workspace's live subscription, if any. */
export async function getActiveSubscription(
  admin: SupabaseClient,
  orgId: string,
): Promise<OrgSubscription | null> {
  const { data, error } = await admin
    .from("org_subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .in("status", [...ACTIVE_SUBSCRIPTION_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToSubscription(data as Record<string, unknown>);
}

/** Looks up a subscription by its Stripe id (webhook path). */
export async function getSubscriptionByStripeId(
  admin: SupabaseClient,
  stripeSubscriptionId: string,
): Promise<OrgSubscription | null> {
  const { data, error } = await admin
    .from("org_subscriptions")
    .select("*")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToSubscription(data as Record<string, unknown>);
}

/** Hosted Checkout for a monthly plan. Prices are built inline (no dashboard setup). */
export async function createPlanCheckoutSession(input: {
  plan: RelayPlan;
  orgId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  if (!stripeConfigured()) throw new Error("Card payments are not enabled on this deployment");
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: input.orgId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.plan.amountCents,
          recurring: { interval: "month" },
          product_data: {
            name: `RELAY ${input.plan.name} — ${input.plan.monthlyCredits.toLocaleString()} credits/mo`,
          },
        },
      },
    ],
    subscription_data: {
      metadata: {
        orgId: input.orgId,
        userId: input.userId,
        planId: input.plan.planId,
      },
    },
    metadata: {
      orgId: input.orgId,
      userId: input.userId,
      planId: input.plan.planId,
    },
    success_url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}plan=success`,
    cancel_url: `${input.cancelUrl}${input.cancelUrl.includes("?") ? "&" : "?"}plan=cancel`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { id: session.id, url: session.url };
}

/** Stripe's hosted customer portal: the self-serve way to change or cancel. */
export async function createBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  if (!stripeConfigured()) throw new Error("Card payments are not enabled on this deployment");
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  return { url: session.url };
}

function unixToIso(sec: number | null | undefined): string | null {
  if (!sec) return null;
  return new Date(sec * 1000).toISOString();
}

/** Upserts org_subscriptions from a Stripe Subscription object. */
export async function syncSubscriptionFromStripe(
  admin: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<void> {
  const metadata = (sub.metadata ?? {}) as Record<string, string>;
  const orgId = metadata["orgId"];
  const planId = metadata["planId"];
  if (!orgId || !planId || !PLAN_BY_ID[planId]) {
    console.log(
      JSON.stringify({
        event: "stripe_sub_unknown_plan",
        subscriptionId: sub.id,
        metadata,
      }),
    );
    return;
  }

  // Stripe v22: the billing period lives on the subscription item, not the
  // subscription itself.
  const item = sub.items?.data?.[0];

  await admin.from("org_subscriptions").upsert(
    {
      org_id: orgId,
      plan_id: planId,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
      stripe_subscription_id: sub.id,
      status: sub.status,
      current_period_start: unixToIso(item?.current_period_start),
      current_period_end: unixToIso(item?.current_period_end),
      cancel_at_period_end: sub.cancel_at_period_end === true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
}

export async function markSubscriptionCanceled(
  admin: SupabaseClient,
  stripeSubscriptionId: string,
): Promise<void> {
  await admin
    .from("org_subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", stripeSubscriptionId);
}

/**
 * Computes this period's grant: monthly credits plus rollover of the
 * previous period's unused subscription credits, capped at the plan cap.
 */
export async function computePeriodGrant(
  admin: SupabaseClient,
  input: { orgId: string; subscriptionId: string; plan: RelayPlan },
): Promise<{ monthly: number; rollover: number; grant: number }> {
  const { data: last } = await admin
    .from("subscription_periods")
    .select("granted_credits, period_start")
    .eq("subscription_id", input.subscriptionId)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  let rollover = 0;
  if (last) {
    const { data: debits } = await admin
      .from("credit_ledger")
      .select("delta")
      .eq("org_id", input.orgId)
      .lt("delta", 0)
      .gte("created_at", String((last as Record<string, unknown>)["period_start"]));
    const spent = (debits ?? []).reduce(
      (sum, r) => sum + Math.abs(Number((r as Record<string, unknown>)["delta"] ?? 0)),
      0,
    );
    const granted = Number((last as Record<string, unknown>)["granted_credits"] ?? 0);
    rollover = Math.min(input.plan.rolloverCap, Math.max(0, granted - spent));
  }

  return { monthly: input.plan.monthlyCredits, rollover, grant: input.plan.monthlyCredits + rollover };
}

/**
 * Grants one period's credits for a paid invoice. Idempotent on the invoice
 * id: a replayed webhook credits nothing twice. Returns whether this call
 * performed the grant.
 */
export async function grantPeriodCredits(
  admin: SupabaseClient,
  input: {
    subscription: OrgSubscription;
    plan: RelayPlan;
    invoice: { id: string; periodStart: string | null; periodEnd: string | null };
  },
): Promise<{ granted: boolean; credits: number; rollover: number }> {
  const { grant, rollover } = await computePeriodGrant(admin, {
    orgId: input.subscription.orgId,
    subscriptionId: input.subscription.id,
    plan: input.plan,
  });

  const { error: ledgerError } = await admin.from("credit_ledger").insert({
    org_id: input.subscription.orgId,
    delta: grant,
    kind: "subscription",
    source: "stripe",
    external_ref: input.invoice.id,
    description:
      `RELAY ${input.plan.name} — ${grant.toLocaleString()} credits ` +
      `(${input.plan.monthlyCredits.toLocaleString()} monthly + ${rollover.toLocaleString()} rollover)`,
  });

  const duplicate = Boolean(
    ledgerError && ledgerError.message.includes("duplicate key"),
  );
  if (ledgerError && !duplicate) throw new Error(`ledger write failed: ${ledgerError.message}`);
  if (duplicate) return { granted: false, credits: grant, rollover };

  await admin.from("subscription_periods").insert({
    subscription_id: input.subscription.id,
    org_id: input.subscription.orgId,
    invoice_id: input.invoice.id,
    period_start: input.invoice.periodStart ?? new Date().toISOString(),
    period_end:
      input.invoice.periodEnd ??
      new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    granted_credits: grant,
    rollover_credits: rollover,
  });

  await admin.from("audit_logs").insert({
    org_id: input.subscription.orgId,
    user_id: null,
    action: "subscription.credits_granted",
    payload: {
      source: "stripe",
      subscriptionId: input.subscription.stripeSubscriptionId,
      invoiceId: input.invoice.id,
      planId: input.plan.planId,
      credits: grant,
      rollover,
    },
  });

  return { granted: true, credits: grant, rollover };
}
