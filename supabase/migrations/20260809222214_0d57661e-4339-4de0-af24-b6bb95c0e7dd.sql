CREATE TABLE public.tool_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id uuid REFERENCES public.agent_keys(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  args_hash text NOT NULL,
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  credits integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  response jsonb,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tool_confirmations_org ON public.tool_confirmations(org_id, created_at DESC);

GRANT SELECT ON public.tool_confirmations TO authenticated;
GRANT ALL ON public.tool_confirmations TO service_role;

ALTER TABLE public.tool_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org confirmations read" ON public.tool_confirmations
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));

CREATE POLICY "super admin read confirmations" ON public.tool_confirmations
  FOR SELECT TO authenticated USING (public.is_super_admin());

CREATE TRIGGER update_tool_confirmations_updated_at
  BEFORE UPDATE ON public.tool_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.update_org_tools_updated_at();