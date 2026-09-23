import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeConfigured } from "@/lib/api/stripe.server";
import {
  createBillingPortalSession,
  createPlanCheckoutSession,
  getActiveSubscription,
} from "@/lib/api/subscriptions.server";
import { PLAN_BY_ID, RELAY_PLANS } from "@/lib/billing/plans";

export const listPlans = createServerFn({ method: "GET" }).handler(async () => ({
  plans: RELAY_PLANS,
}));

/** The workspace's live subscription (plan details + renewal date), if any. */
export const getSubscriptionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: accessError } = await context.supabase.rpc("has_org_access", {
      _org_id: data.orgId,
    });
    if (accessError) throw new Error(accessError.message);
    if (!allowed) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const subscription = await getActiveSubscription(supabaseAdmin, data.orgId);
    if (!subscription) return { subscription: null };
    return {
      subscription: {
        planId: subscription.planId,
        planName: subscription.plan?.name ?? subscription.planId,
        status: subscription.status,
        renewsAt: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
    };
  });

/**
 * Starts a Stripe Checkout session (subscription mode) for a monthly plan
 * and returns the hosted URL. Success/cancel URLs come from the request's
 * own origin, never the client.
 */
export const createPlanCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; planId: string }) =>
    z.object({ orgId: z.string().uuid(), planId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!stripeConfigured()) {
      throw new Error("Card payments are not enabled on this deployment");
    }

    const { data: allowed, error: accessError } = await context.supabase.rpc("has_org_access", {
      _org_id: data.orgId,
    });
    if (accessError) throw new Error(accessError.message);
    if (!allowed) throw new Error("Forbidden");

    const plan = PLAN_BY_ID[data.planId];
    if (!plan) throw new Error(`Unknown plan: ${data.planId}`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const existing = await getActiveSubscription(supabaseAdmin, data.orgId);
    if (existing) {
      throw new Error(
        `This workspace already has an active ${existing.plan?.name ?? "subscription"} plan. Manage it from the billing portal instead.`,
      );
    }

    const origin = new URL(getRequest().url).origin;

    const session = await createPlanCheckoutSession({
      plan,
      orgId: data.orgId,
      userId: context.userId,
      successUrl: `${origin}/billing`,
      cancelUrl: `${origin}/billing`,
    });

    return { url: session.url };
  });

/** Returns the Stripe customer-portal URL for managing/canceling the plan. */
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) =>
    z.object({ orgId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!stripeConfigured()) {
      throw new Error("Card payments are not enabled on this deployment");
    }

    const { data: allowed, error: accessError } = await context.supabase.rpc("has_org_access", {
      _org_id: data.orgId,
    });
    if (accessError) throw new Error(accessError.message);
    if (!allowed) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const subscription = await getActiveSubscription(supabaseAdmin, data.orgId);
    if (!subscription) throw new Error("This workspace has no active subscription.");

    const origin = new URL(getRequest().url).origin;
    const { url } = await createBillingPortalSession({
      customerId: subscription.stripeCustomerId,
      returnUrl: `${origin}/billing`,
    });
    return { url };
  });
