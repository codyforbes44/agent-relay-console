REVOKE EXECUTE ON FUNCTION public.key_credits_spent(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_credits_spent(uuid, timestamptz) TO service_role;