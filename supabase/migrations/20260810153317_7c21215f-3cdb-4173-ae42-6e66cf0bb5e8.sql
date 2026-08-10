-- 1) Lock down SECURITY DEFINER function from anonymous callers
REVOKE EXECUTE ON FUNCTION public.match_document_chunks(uuid, vector, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(uuid, vector, integer, uuid[]) TO service_role;

-- 2) Prevent privilege escalation through org_members inserts
CREATE OR REPLACE FUNCTION public.org_role_of(_org_id uuid)
RETURNS public.org_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role FROM public.org_members m
  WHERE m.org_id = _org_id AND m.user_id = auth.uid()
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.org_role_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_role_of(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "members can add members" ON public.org_members;

CREATE POLICY "owners and admins can add members"
ON public.org_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.org_role_of(org_id) = 'owner'
  OR (public.org_role_of(org_id) = 'admin' AND role <> 'owner')
);