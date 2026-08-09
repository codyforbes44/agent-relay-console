CREATE TABLE public.agent_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID,
  label TEXT NOT NULL DEFAULT 'Default key',
  key_prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['tools:invoke'],
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_keys_org_idx ON public.agent_keys(org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_keys TO authenticated;
GRANT ALL ON public.agent_keys TO service_role;
ALTER TABLE public.agent_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org keys read" ON public.agent_keys FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "org keys create" ON public.agent_keys FOR INSERT TO authenticated WITH CHECK (public.has_org_access(org_id));
CREATE POLICY "org keys update" ON public.agent_keys FOR UPDATE TO authenticated USING (public.has_org_access(org_id)) WITH CHECK (public.has_org_access(org_id));

CREATE TABLE public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id UUID REFERENCES public.agent_keys(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error_code TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_org_created_idx ON public.usage_events(org_id, created_at DESC);
CREATE INDEX usage_events_key_created_idx ON public.usage_events(key_id, created_at DESC);
GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org usage read" ON public.usage_events FOR SELECT TO authenticated USING (public.has_org_access(org_id));

CREATE TABLE public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  description TEXT,
  usage_event_id UUID REFERENCES public.usage_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_org_idx ON public.credit_ledger(org_id, created_at DESC);
GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org ledger read" ON public.credit_ledger FOR SELECT TO authenticated USING (public.has_org_access(org_id));

CREATE OR REPLACE FUNCTION public.org_credit_balance(_org_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(delta), 0)::int FROM public.credit_ledger WHERE org_id = _org_id;
$$;
REVOKE ALL ON FUNCTION public.org_credit_balance(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_credit_balance(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.grant_starter_credits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.credit_ledger(org_id, delta, kind, description)
  VALUES (NEW.id, 500, 'grant', 'Free starter credits');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_starter_credits() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_org_created_grant_credits
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.grant_starter_credits();

INSERT INTO public.credit_ledger(org_id, delta, kind, description)
SELECT id, 500, 'grant', 'Free starter credits' FROM public.organizations;