CREATE OR REPLACE FUNCTION public.consume_user_rate_limit(_user_id uuid, _max integer DEFAULT 20)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _window TIMESTAMPTZ := date_trunc('minute', now());
  _count INT;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.rate_limits(user_id, window_start, count)
  VALUES (_user_id, _window, 1)
  ON CONFLICT (user_id, window_start) DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO _count;
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour';
  RETURN _count <= _max;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_user_rate_limit(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_user_rate_limit(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.consume_rate_limit(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(integer) TO service_role;