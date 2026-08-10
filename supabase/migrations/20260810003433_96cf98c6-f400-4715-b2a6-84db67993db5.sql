-- 1. Internal SECURITY DEFINER helpers: server-only execution
REVOKE ALL ON FUNCTION public.update_org_tools_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_org_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_starter_credits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_unlimited_credits(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_credit_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.key_credits_spent(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_credits(uuid, uuid, text, integer, text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_reserved_credits(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_signup_quota(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_rate_limit(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Helpers that must stay callable by signed-in users (RLS predicates / claim flow):
-- has_role, has_org_access, is_super_admin, claim_organization, consume_rate_limit(integer)
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_org_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_organization(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_rate_limit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(integer) TO authenticated;

-- 2. Internal bookkeeping tables: server-side (service_role) only, explicitly denied to clients
REVOKE ALL ON TABLE public.api_idempotency FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.claim_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.signup_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_idempotency TO service_role;
GRANT ALL ON TABLE public.claim_tokens TO service_role;
GRANT ALL ON TABLE public.signup_attempts TO service_role;
GRANT ALL ON TABLE public.api_rate_limits TO service_role;

ALTER TABLE public.api_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_idempotency_no_client_access" ON public.api_idempotency;
CREATE POLICY "api_idempotency_no_client_access" ON public.api_idempotency
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "claim_tokens_no_client_write" ON public.claim_tokens;
CREATE POLICY "claim_tokens_no_client_write" ON public.claim_tokens
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (public.is_super_admin()) WITH CHECK (false);

DROP POLICY IF EXISTS "signup_attempts_no_client_write" ON public.signup_attempts;
CREATE POLICY "signup_attempts_no_client_write" ON public.signup_attempts
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (public.is_super_admin()) WITH CHECK (false);

COMMENT ON TABLE public.api_idempotency IS 'Server-only idempotency store; accessed exclusively via service_role.';
COMMENT ON TABLE public.claim_tokens IS 'Server-only claim tokens; redeemed through claim_organization().';
COMMENT ON TABLE public.signup_attempts IS 'Server-only signup abuse counters; written via consume_signup_quota().';