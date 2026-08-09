REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_org_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_org_access(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.consume_rate_limit(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(INT) TO authenticated;