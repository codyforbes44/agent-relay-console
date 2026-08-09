CREATE TABLE public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id uuid REFERENCES public.agent_keys(id) ON DELETE SET NULL,
  nonce text NOT NULL UNIQUE,
  purpose text NOT NULL DEFAULT 'tool_call',
  tool_name text,
  credits integer NOT NULL,
  amount_atomic text NOT NULL,
  amount_usd numeric(12,6) NOT NULL,
  asset text NOT NULL,
  network text NOT NULL,
  pay_to text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payer text,
  tx_hash text,
  request_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX idx_payment_intents_org ON public.payment_intents(org_id, created_at DESC);

GRANT SELECT ON public.payment_intents TO authenticated;
GRANT ALL ON public.payment_intents TO service_role;

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org payments read" ON public.payment_intents
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));

CREATE POLICY "super admin read payments" ON public.payment_intents
  FOR SELECT TO authenticated USING (public.is_super_admin());

ALTER TABLE public.credit_ledger
  ADD COLUMN source text,
  ADD COLUMN external_ref text;

CREATE UNIQUE INDEX idx_credit_ledger_external_ref
  ON public.credit_ledger(source, external_ref)
  WHERE external_ref IS NOT NULL;

ALTER TABLE public.agent_keys
  ADD COLUMN max_credits_per_call integer,
  ADD COLUMN daily_credit_cap integer,
  ADD COLUMN total_credit_cap integer,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN allowed_tools text[];

CREATE OR REPLACE FUNCTION public.key_credits_spent(_key_id uuid, _since timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(credits), 0)::int
  FROM public.usage_events
  WHERE key_id = _key_id
    AND created_at >= _since;
$$;