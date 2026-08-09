DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('super_admin','admin','member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin');
$$;

CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());
CREATE POLICY "super admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

INSERT INTO public.user_roles (user_id, role)
VALUES ('2921cd10-fa1c-470e-bbcd-8e011b17ce02','super_admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- Platform-wide read access for super admins
CREATE POLICY "super admin read orgs" ON public.organizations FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read members" ON public.org_members FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read conversations" ON public.conversations FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read messages" ON public.messages FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read tool calls" ON public.tool_calls FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read jobs" ON public.jobs FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read audit" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read keys" ON public.agent_keys FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin update keys" ON public.agent_keys FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "super admin read usage" ON public.usage_events FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin read ledger" ON public.credit_ledger FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "super admin adjust ledger" ON public.credit_ledger FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());
CREATE POLICY "super admin read purchases" ON public.credit_purchases FOR SELECT TO authenticated USING (public.is_super_admin());