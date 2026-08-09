-- Indexes supporting per-key spend aggregates and refunds
CREATE INDEX IF NOT EXISTS idx_usage_events_key_created ON public.usage_events (key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_usage_event ON public.credit_ledger (usage_event_id);

-- Idempotency retention
ALTER TABLE public.api_idempotency ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_api_idempotency_expires ON public.api_idempotency (expires_at);

/**
 * Atomically authorizes and charges a tool call.
 * Returns jsonb: {status: 'ok'|'insufficient'|'budget_exceeded', ...}
 * All checks (balance + owner-set key caps) run inside one transaction under
 * a per-org advisory lock, so concurrent calls cannot double-spend.
 */
CREATE OR REPLACE FUNCTION public.reserve_credits(
  _org_id UUID,
  _key_id UUID,
  _tool_name TEXT,
  _credits INT,
  _request_id TEXT,
  _latency_ms INT DEFAULT 0,
  _max_per_call INT DEFAULT NULL,
  _daily_cap INT DEFAULT NULL,
  _total_cap INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _unlimited BOOLEAN;
  _balance INT;
  _spent INT;
  _event_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_org_id::text, 0));

  IF _max_per_call IS NOT NULL AND _credits > _max_per_call THEN
    RETURN jsonb_build_object('status', 'budget_exceeded', 'window', 'call',
      'spent', 0, 'required', _credits, 'limit', _max_per_call);
  END IF;

  IF _key_id IS NOT NULL AND _daily_cap IS NOT NULL THEN
    SELECT COALESCE(SUM(credits), 0)::int INTO _spent
    FROM public.usage_events
    WHERE key_id = _key_id AND created_at >= now() - interval '24 hours';
    IF _spent + _credits > _daily_cap THEN
      RETURN jsonb_build_object('status', 'budget_exceeded', 'window', '24h',
        'spent', _spent, 'required', _credits, 'limit', _daily_cap);
    END IF;
  END IF;

  IF _key_id IS NOT NULL AND _total_cap IS NOT NULL THEN
    SELECT COALESCE(SUM(credits), 0)::int INTO _spent
    FROM public.usage_events WHERE key_id = _key_id;
    IF _spent + _credits > _total_cap THEN
      RETURN jsonb_build_object('status', 'budget_exceeded', 'window', 'lifetime',
        'spent', _spent, 'required', _credits, 'limit', _total_cap);
    END IF;
  END IF;

  _unlimited := COALESCE((SELECT unlimited_credits FROM public.organizations WHERE id = _org_id), false);

  IF _unlimited THEN
    _balance := NULL;
  ELSE
    SELECT COALESCE(SUM(delta), 0)::int INTO _balance
    FROM public.credit_ledger WHERE org_id = _org_id;

    IF _balance < _credits THEN
      RETURN jsonb_build_object('status', 'insufficient', 'balance', _balance, 'required', _credits);
    END IF;
  END IF;

  INSERT INTO public.usage_events(org_id, key_id, tool_name, credits, status, latency_ms, request_id)
  VALUES (_org_id, _key_id, _tool_name, _credits, 'success', COALESCE(_latency_ms, 0), _request_id)
  RETURNING id INTO _event_id;

  IF _credits > 0 AND NOT _unlimited THEN
    INSERT INTO public.credit_ledger(org_id, delta, kind, description, usage_event_id)
    VALUES (_org_id, -_credits, 'usage', 'Tool call: ' || _tool_name, _event_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'usageEventId', _event_id,
    'unlimited', _unlimited,
    'balance', CASE WHEN _unlimited THEN NULL ELSE _balance - _credits END
  );
END;
$$;

/** Compensating entry when a tool throws after its credits were reserved. */
CREATE OR REPLACE FUNCTION public.refund_reserved_credits(_usage_event_id UUID, _reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org_id UUID;
  _credits INT;
  _tool TEXT;
BEGIN
  SELECT org_id, credits, tool_name INTO _org_id, _credits, _tool
  FROM public.usage_events WHERE id = _usage_event_id;
  IF _org_id IS NULL THEN RETURN false; END IF;

  UPDATE public.usage_events
     SET status = 'error', error_code = COALESCE(LEFT(_reason, 100), 'tool_failed'), credits = 0
   WHERE id = _usage_event_id;

  IF _credits > 0 AND EXISTS (
    SELECT 1 FROM public.credit_ledger WHERE usage_event_id = _usage_event_id AND delta < 0
  ) THEN
    INSERT INTO public.credit_ledger(org_id, delta, kind, description, usage_event_id)
    VALUES (_org_id, _credits, 'refund', 'Refund — failed call: ' || _tool, _usage_event_id);
  END IF;

  RETURN true;
END;
$$;

/** Atomic per-IP signup counter. Returns true when the call is within quota. */
CREATE OR REPLACE FUNCTION public.consume_signup_quota(_ip_hash TEXT, _max INT, _window_hours INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _window TIMESTAMPTZ := date_trunc('hour', now());
  _used INT;
BEGIN
  INSERT INTO public.signup_attempts(ip_hash, window_start, count)
  VALUES (_ip_hash, _window, 1)
  ON CONFLICT (ip_hash, window_start) DO UPDATE SET count = public.signup_attempts.count + 1;

  SELECT COALESCE(SUM(count), 0)::int INTO _used
  FROM public.signup_attempts
  WHERE ip_hash = _ip_hash AND window_start >= now() - (_window_hours || ' hours')::interval;

  DELETE FROM public.signup_attempts WHERE window_start < now() - interval '30 days';

  RETURN _used <= _max;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_credits(UUID, UUID, TEXT, INT, TEXT, INT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_reserved_credits(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_signup_quota(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, TEXT, INT, TEXT, INT, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_reserved_credits(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_signup_quota(TEXT, INT, INT) TO service_role;