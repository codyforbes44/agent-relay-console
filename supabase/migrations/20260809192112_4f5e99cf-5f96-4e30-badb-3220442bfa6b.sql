CREATE TABLE public.api_idempotency (
  key_id UUID NOT NULL,
  idem_key TEXT NOT NULL,
  org_id UUID NOT NULL,
  tool_name TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, idem_key)
);
GRANT ALL ON public.api_idempotency TO service_role;
ALTER TABLE public.api_idempotency ENABLE ROW LEVEL SECURITY;