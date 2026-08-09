CREATE TABLE public.org_settings (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  mcp_base_url TEXT NOT NULL DEFAULT 'https://3bi.ai',
  mcp_path_pattern TEXT NOT NULL DEFAULT '/mcp?tenant={org_id}',
  confirmation_default TEXT NOT NULL DEFAULT 'side_effecting',
  job_retention_days INTEGER NOT NULL DEFAULT 30,
  message_retention_days INTEGER NOT NULL DEFAULT 90,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT org_settings_confirmation_default_check CHECK (confirmation_default IN ('side_effecting','all','none')),
  CONSTRAINT org_settings_job_retention_check CHECK (job_retention_days BETWEEN 1 AND 3650),
  CONSTRAINT org_settings_message_retention_check CHECK (message_retention_days BETWEEN 1 AND 3650)
);

GRANT SELECT, INSERT, UPDATE ON public.org_settings TO authenticated;
GRANT ALL ON public.org_settings TO service_role;

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org settings read" ON public.org_settings
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "org settings insert" ON public.org_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_org_access(org_id));
CREATE POLICY "org settings update" ON public.org_settings
  FOR UPDATE TO authenticated USING (public.has_org_access(org_id)) WITH CHECK (public.has_org_access(org_id));
CREATE POLICY "super admin read org settings" ON public.org_settings
  FOR SELECT TO authenticated USING (public.is_super_admin());

CREATE TRIGGER update_org_settings_updated_at
  BEFORE UPDATE ON public.org_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_org_tools_updated_at();

INSERT INTO public.org_settings (org_id)
SELECT id FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_org_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.org_settings(org_id) VALUES (NEW.id)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_org_created_seed_settings
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_org_settings();