CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key_id UUID NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, window_start)
);

GRANT ALL ON public.api_rate_limits TO service_role;

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages rate limits"
  ON public.api_rate_limits FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consume_rate_limit(_key_id UUID, _limit INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _window TIMESTAMPTZ := date_trunc('minute', now());
  _used INT;
BEGIN
  INSERT INTO public.api_rate_limits(key_id, window_start, count)
  VALUES (_key_id, _window, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET count = public.api_rate_limits.count + 1
  RETURNING count INTO _used;

  IF random() < 0.01 THEN
    DELETE FROM public.api_rate_limits WHERE window_start < now() - interval '1 hour';
  END IF;

  RETURN _used <= _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(UUID, INT) TO service_role;