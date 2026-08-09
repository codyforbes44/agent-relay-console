ALTER TABLE public.organizations ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'human';
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE TABLE public.claim_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  claimed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_claim_tokens_org ON public.claim_tokens(org_id);
GRANT ALL ON public.claim_tokens TO service_role;
ALTER TABLE public.claim_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin read claim tokens" ON public.claim_tokens
  FOR SELECT TO authenticated USING (public.is_super_admin());

CREATE TABLE public.signup_attempts (
  ip_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window_start)
);
GRANT ALL ON public.signup_attempts TO service_role;
ALTER TABLE public.signup_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_organization(_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT org_id INTO _org_id
  FROM public.claim_tokens
  WHERE token_hash = _token_hash
    AND claimed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF _org_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.claim_tokens
     SET claimed_at = now(), claimed_by = auth.uid()
   WHERE token_hash = _token_hash;

  INSERT INTO public.org_members(org_id, user_id, role)
  VALUES (_org_id, auth.uid(), 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  UPDATE public.organizations
     SET created_by = COALESCE(created_by, auth.uid()),
         claimed_at = COALESCE(claimed_at, now())
   WHERE id = _org_id;

  RETURN _org_id;
END;
$$;