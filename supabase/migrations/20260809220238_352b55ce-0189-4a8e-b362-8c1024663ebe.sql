CREATE TABLE public.org_tools (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  requires_confirmation boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (org_id, tool_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_tools TO authenticated;
GRANT ALL ON public.org_tools TO service_role;

ALTER TABLE public.org_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can manage their tools" ON public.org_tools
  FOR ALL TO authenticated
  USING (has_org_access(org_id))
  WITH CHECK (has_org_access(org_id));

CREATE POLICY "Super admins can read org tools" ON public.org_tools
  FOR SELECT TO authenticated
  USING (is_super_admin());

CREATE OR REPLACE FUNCTION public.update_org_tools_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_org_tools_updated_at
BEFORE UPDATE ON public.org_tools
FOR EACH ROW EXECUTE FUNCTION public.update_org_tools_updated_at();

-- Seed every existing organization with the current tool set, enabled by default.
INSERT INTO public.org_tools (org_id, tool_name, requires_confirmation)
SELECT o.id, t.name, t.side_effecting
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('search_knowledge_base', false),
    ('lookup_crm_contact', false),
    ('list_records', false),
    ('send_email', true),
    ('update_crm_record', true),
    ('create_payment', true),
    ('delete_record', true)
) AS t(name, side_effecting)
ON CONFLICT (org_id, tool_name) DO NOTHING;

-- Ensure future organizations get tool rows created automatically.
CREATE OR REPLACE FUNCTION public.seed_org_tools()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.org_tools (org_id, tool_name, requires_confirmation)
  SELECT NEW.id, t.name, t.side_effecting
  FROM (
    VALUES
      ('search_knowledge_base', false),
      ('lookup_crm_contact', false),
      ('list_records', false),
      ('send_email', true),
      ('update_crm_record', true),
      ('create_payment', true),
      ('delete_record', true)
  ) AS t(name, side_effecting)
  ON CONFLICT (org_id, tool_name) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_org_created_seed_tools
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_org_tools();
