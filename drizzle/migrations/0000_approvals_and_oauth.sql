CREATE TABLE public.approval_policies (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  auto_approve_max_credits INTEGER NOT NULL DEFAULT 0,
  auto_approve_tools TEXT[] NOT NULL DEFAULT '{}',
  require_human_tools TEXT[] NOT NULL DEFAULT '{}',
  default_action TEXT NOT NULL DEFAULT 'human' CHECK (default_action IN ('human', 'auto')),
  webhook_secret TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  notify_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.approval_policies TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.approval_policies TO authenticated;
ALTER TABLE public.approval_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read approval policy" ON public.approval_policies
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "org members write approval policy" ON public.approval_policies
  FOR ALL TO authenticated USING (public.has_org_access(org_id))
  WITH CHECK (public.has_org_access(org_id));

CREATE TABLE public.approval_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id UUID REFERENCES public.agent_keys(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_label TEXT NOT NULL,
  args JSONB NOT NULL,
  args_hash TEXT NOT NULL,
  preview JSONB NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  callback_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  policy_decision TEXT NOT NULL DEFAULT 'human'
    CHECK (policy_decision IN ('auto', 'human')),
  confirmation_token TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX approval_intents_org_status_idx
  ON public.approval_intents(org_id, status, created_at DESC);
CREATE INDEX approval_intents_expires_idx
  ON public.approval_intents(expires_at) WHERE status = 'pending';
GRANT ALL ON public.approval_intents TO service_role;
GRANT SELECT, UPDATE ON public.approval_intents TO authenticated;
ALTER TABLE public.approval_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read approval intents" ON public.approval_intents
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "org members update approval intents" ON public.approval_intents
  FOR UPDATE TO authenticated USING (public.has_org_access(org_id))
  WITH CHECK (public.has_org_access(org_id));

CREATE TABLE public.oauth_providers (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  authorize_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  revoke_url TEXT,
  default_scopes TEXT[] NOT NULL DEFAULT '{}',
  docs_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true
);
GRANT ALL ON public.oauth_providers TO service_role;
GRANT SELECT ON public.oauth_providers TO authenticated, anon;
ALTER TABLE public.oauth_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oauth providers are public" ON public.oauth_providers
  FOR SELECT TO authenticated, anon USING (enabled = true);

INSERT INTO public.oauth_providers (slug, name, authorize_url, token_url, revoke_url, default_scopes, docs_url)
VALUES
  ('google', 'Google',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token',
    'https://oauth2.googleapis.com/revoke',
    ARRAY['https://www.googleapis.com/auth/gmail.send'],
    'https://developers.google.com/identity/protocols/oauth2'),
  ('github', 'GitHub',
    'https://github.com/login/oauth/authorize',
    'https://github.com/login/oauth/access_token',
    NULL,
    ARRAY['repo'],
    'https://docs.github.com/en/apps/oauth-apps'),
  ('slack', 'Slack',
    'https://slack.com/oauth/v2/authorize',
    'https://slack.com/api/oauth.v2.access',
    'https://slack.com/api/auth.revoke',
    ARRAY['chat:write', 'chat:write.public'],
    'https://docs.slack.dev/authentication/')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  authorize_url = EXCLUDED.authorize_url,
  token_url = EXCLUDED.token_url,
  revoke_url = EXCLUDED.revoke_url,
  default_scopes = EXCLUDED.default_scopes,
  docs_url = EXCLUDED.docs_url,
  enabled = true;

CREATE TABLE public.oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_slug TEXT NOT NULL REFERENCES public.oauth_providers(slug),
  account_label TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  created_by_key_id UUID REFERENCES public.agent_keys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider_slug, account_label)
);
CREATE INDEX oauth_connections_org_idx
  ON public.oauth_connections(org_id, provider_slug, status);
GRANT ALL ON public.oauth_connections TO service_role;
ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE VIEW public.oauth_connection_summaries
WITH (security_invoker = true) AS
  SELECT id, org_id, provider_slug, account_label, scopes, status,
         expires_at, created_at, updated_at
  FROM public.oauth_connections;
GRANT SELECT ON public.oauth_connection_summaries TO authenticated;
GRANT SELECT (id, org_id, provider_slug, account_label, scopes, status,
              expires_at, created_at, updated_at)
  ON public.oauth_connections TO authenticated;
CREATE POLICY "org members read connection metadata"
  ON public.oauth_connections
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));

CREATE TABLE public.oauth_states (
  state TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id UUID REFERENCES public.agent_keys(id) ON DELETE SET NULL,
  provider_slug TEXT NOT NULL REFERENCES public.oauth_providers(slug),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at TIMESTAMPTZ
);
GRANT ALL ON public.oauth_states TO service_role;
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;