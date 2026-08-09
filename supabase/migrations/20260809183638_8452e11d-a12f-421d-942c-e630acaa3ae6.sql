CREATE TABLE public.credit_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  transaction_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  price_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  credits INTEGER NOT NULL,
  amount_cents INTEGER,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, environment)
);

GRANT SELECT ON public.credit_purchases TO authenticated;
GRANT ALL ON public.credit_purchases TO service_role;

ALTER TABLE public.credit_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org purchases read" ON public.credit_purchases
  FOR SELECT TO authenticated
  USING (public.has_org_access(org_id));

CREATE INDEX idx_credit_purchases_org ON public.credit_purchases(org_id, created_at DESC);