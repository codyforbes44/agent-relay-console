-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- organizations
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TYPE public.org_role AS ENUM ('owner','admin','member');

CREATE TABLE public.org_members (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.org_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
GRANT SELECT, INSERT, DELETE, UPDATE ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_org_access(_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = _org_id AND m.user_id = auth.uid());
$$;

CREATE POLICY "members read orgs" ON public.organizations FOR SELECT TO authenticated USING (public.has_org_access(id));
CREATE POLICY "create orgs" ON public.organizations FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "owners update orgs" ON public.organizations FOR UPDATE TO authenticated USING (public.has_org_access(id)) WITH CHECK (public.has_org_access(id));

CREATE POLICY "read own memberships" ON public.org_members FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_org_access(org_id));
CREATE POLICY "self join created org" ON public.org_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.has_org_access(org_id));
CREATE POLICY "manage memberships" ON public.org_members FOR DELETE TO authenticated USING (public.has_org_access(org_id));

-- conversations
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org conversations" ON public.conversations FOR ALL TO authenticated
  USING (public.has_org_access(org_id)) WITH CHECK (public.has_org_access(org_id));

-- messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'complete',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON public.messages(conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org messages" ON public.messages FOR ALL TO authenticated
  USING (public.has_org_access(org_id)) WITH CHECK (public.has_org_access(org_id));

-- tool calls
CREATE TABLE public.tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  side_effecting BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID
);
CREATE INDEX tool_calls_conversation_idx ON public.tool_calls(conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_calls TO authenticated;
GRANT ALL ON public.tool_calls TO service_role;
ALTER TABLE public.tool_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org tool calls" ON public.tool_calls FOR ALL TO authenticated
  USING (public.has_org_access(org_id)) WITH CHECK (public.has_org_access(org_id));

-- jobs
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX jobs_conversation_idx ON public.jobs(conversation_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org jobs" ON public.jobs FOR ALL TO authenticated
  USING (public.has_org_access(org_id)) WITH CHECK (public.has_org_access(org_id));

-- audit logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  tool_name TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON public.audit_logs(org_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org audit read" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "org audit write" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.has_org_access(org_id));

-- idempotency keys
CREATE TABLE public.idempotency_keys (
  key TEXT NOT NULL,
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id)
);
GRANT SELECT, INSERT, UPDATE ON public.idempotency_keys TO authenticated;
GRANT ALL ON public.idempotency_keys TO service_role;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own idempotency" ON public.idempotency_keys FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- rate limits
CREATE TABLE public.rate_limits (
  user_id UUID NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, window_start)
);
GRANT SELECT ON public.rate_limits TO authenticated;
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rate limits" ON public.rate_limits FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.consume_rate_limit(_max INT DEFAULT 20)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _window TIMESTAMPTZ := date_trunc('minute', now());
  _count INT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  INSERT INTO public.rate_limits(user_id, window_start, count)
  VALUES (auth.uid(), _window, 1)
  ON CONFLICT (user_id, window_start) DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO _count;
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour';
  RETURN _count <= _max;
END;
$$;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(INT) TO authenticated;

-- signup bootstrap: profile + personal organization
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org_id UUID;
  _name TEXT;
BEGIN
  _name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Member');
  INSERT INTO public.profiles(id, email, display_name) VALUES (NEW.id, NEW.email, _name)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.organizations(name, slug, created_by)
    VALUES (_name || '''s workspace', 'org-' || replace(NEW.id::text, '-', ''), NEW.id)
    RETURNING id INTO _org_id;
  INSERT INTO public.org_members(org_id, user_id, role) VALUES (_org_id, NEW.id, 'owner');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();