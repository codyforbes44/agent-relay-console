CREATE TABLE public.org_api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service text NOT NULL CHECK (service ~ '^[a-z0-9_\-\.]{1,40}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext text NOT NULL,
  secret_last4 text NOT NULL,
  created_by uuid,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, service, label)
);

GRANT SELECT (id, org_id, service, label, config, secret_last4, created_by, last_verified_at, created_at, updated_at)
  ON public.org_api_credentials TO authenticated;
GRANT ALL ON public.org_api_credentials TO service_role;

ALTER TABLE public.org_api_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workspace credential metadata"
ON public.org_api_credentials FOR SELECT TO authenticated
USING (public.has_org_access(org_id));