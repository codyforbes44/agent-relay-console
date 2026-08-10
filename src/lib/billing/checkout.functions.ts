import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createPackCheckoutSession, stripeConfigured } from "@/lib/api/stripe.server";
import { CREDIT_PACKS } from "@/lib/billing/packs";

export const isCardCheckoutEnabled = createServerFn({ method: "GET" }).handler(async () => ({
  enabled: stripeConfigured(),
}));

/**
 * Starts a Stripe Checkout session for one credit pack and returns the
 * hosted URL to redirect the browser to. Success/cancel URLs are derived
 * from the incoming request's own origin (not client-supplied), so this
 * can't be used to redirect a paying session anywhere else.
 */
export const createCreditCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; priceId: string }) =>
    z.object({ orgId: z.string().uuid(), priceId: z.string().min(1) }).parse(input),
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

    const pack = CREDIT_PACKS.find((p) => p.priceId === data.priceId);
    if (!pack) throw new Error(`Unknown credit pack: ${data.priceId}`);

    const origin = new URL(getRequest().url).origin;

    const session = await createPackCheckoutSession({
      pack,
      orgId: data.orgId,
      userId: context.userId,
      successUrl: `${origin}/billing?checkout=success`,
      cancelUrl: `${origin}/billing?checkout=cancel`,
    });

    return { url: session.url };
  });
