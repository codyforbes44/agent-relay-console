-- Monthly subscription plans: workspace subscriptions (Stripe) and the
-- per-period credit grants that fund them.
--
-- Rollover accounting treats subscription credits as consumed first: each
-- period's unused subscription credits (capped at the plan's rollover cap)
-- are added to the next period's grant. Pack credits never expire and are
-- unaffected.

CREATE TABLE public.org_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live subscription per workspace; history stays in canceled rows.
CREATE UNIQUE INDEX org_subscriptions_one_active_per_org
  ON public.org_subscriptions(org_id)
  WHERE status IN ('active', 'trialing', 'past_due');

CREATE TABLE public.subscription_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.org_subscriptions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL UNIQUE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  granted_credits INTEGER NOT NULL,
  rollover_credits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscription_periods_sub_idx
  ON public.subscription_periods(subscription_id, period_start DESC);

GRANT SELECT ON public.org_subscriptions TO authenticated;
GRANT SELECT ON public.subscription_periods TO authenticated;
GRANT ALL ON public.org_subscriptions TO service_role;
GRANT ALL ON public.subscription_periods TO service_role;
ALTER TABLE public.org_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org subscriptions read" ON public.org_subscriptions
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "org subscription periods read" ON public.subscription_periods
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));
