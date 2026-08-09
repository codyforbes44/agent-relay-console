ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS unlimited_credits BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.org_unlimited_credits(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT unlimited_credits FROM public.organizations WHERE id = _org_id), false);
$$;

GRANT EXECUTE ON FUNCTION public.org_unlimited_credits(uuid) TO authenticated, service_role;

UPDATE public.organizations o
SET unlimited_credits = true
WHERE EXISTS (
  SELECT 1 FROM public.org_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.org_id = o.id AND p.email = '3biio@proton.me' AND m.role = 'owner'
);