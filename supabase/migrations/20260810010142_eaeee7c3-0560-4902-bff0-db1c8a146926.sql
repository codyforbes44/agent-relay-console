DROP POLICY IF EXISTS "self join created org" ON public.org_members;

CREATE POLICY "members can add members"
ON public.org_members
FOR INSERT
TO authenticated
WITH CHECK (public.has_org_access(org_id));