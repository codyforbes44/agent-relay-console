REVOKE ALL ON FUNCTION public.claim_organization(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_organization(TEXT) TO authenticated, service_role;

GRANT SELECT ON public.signup_attempts TO authenticated;
CREATE POLICY "super admin read signup attempts" ON public.signup_attempts
  FOR SELECT TO authenticated USING (public.is_super_admin());