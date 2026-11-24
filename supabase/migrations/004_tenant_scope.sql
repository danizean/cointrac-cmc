-- Stage 5.2.1 tenant scope. Additive only. No historical backfill and no row deletes.
-- Apply only to Development fflwfpmbyykyxhlhikwc after a policy preflight with zero unexpected policies.

BEGIN;

ALTER TABLE public.api_keys
  ADD COLUMN user_id UUID REFERENCES auth.users (id) ON DELETE RESTRICT,
  ADD COLUMN revoked_at TIMESTAMPTZ;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_revoked_implies_inactive
  CHECK (revoked_at IS NULL OR is_active = FALSE);

ALTER TABLE public.evidence_records
  ADD COLUMN user_id UUID REFERENCES auth.users (id) ON DELETE RESTRICT,
  ADD COLUMN api_key_id UUID REFERENCES public.api_keys (id) ON DELETE SET NULL;

ALTER TABLE public.request_logs
  ADD COLUMN user_id UUID REFERENCES auth.users (id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION private.guard_api_key_revocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'api key rows cannot be deleted' USING ERRCODE = '42501';
  END IF;

  IF OLD.revoked_at IS NOT NULL THEN
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.is_active
       OR NEW.key_hash IS DISTINCT FROM OLD.key_hash
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'revoked api key cannot be restored or reassigned'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_api_key_revocation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.guard_api_key_revocation() TO service_role;

CREATE TRIGGER guard_api_key_revocation
  BEFORE UPDATE OR DELETE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_api_key_revocation();

CREATE OR REPLACE FUNCTION private.guard_owner_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'owner cannot be transferred' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_owner_reassignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.guard_owner_reassignment() TO service_role;

CREATE TRIGGER guard_evidence_owner
  BEFORE UPDATE ON public.evidence_records
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_owner_reassignment();

CREATE TRIGGER guard_request_log_owner
  BEFORE UPDATE ON public.request_logs
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_owner_reassignment();

CREATE INDEX evidence_records_owner_created_idx
  ON public.evidence_records (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX request_logs_owner_created_idx
  ON public.request_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX api_keys_owner_idx
  ON public.api_keys (user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_records FORCE ROW LEVEL SECURITY;
ALTER TABLE public.request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_logs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.api_keys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.evidence_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.request_logs FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, user_id, key_prefix, label, is_sandbox,
  rate_limit_per_min, is_active, revoked_at, created_at
) ON public.api_keys TO authenticated;

GRANT SELECT ON public.evidence_records TO authenticated;

GRANT SELECT (
  user_id, surface, tool_name, status_code, latency_ms,
  cache_hit, credit_cost, evidence_id, created_at
) ON public.request_logs TO authenticated;

CREATE POLICY api_keys_select_own
  ON public.api_keys
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = (SELECT auth.uid()));

CREATE POLICY evidence_select_own
  ON public.evidence_records
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = (SELECT auth.uid()));

CREATE POLICY request_logs_select_own
  ON public.request_logs
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = (SELECT auth.uid()));

CREATE TABLE private.rate_windows (
  principal_id TEXT PRIMARY KEY
    CHECK (
      principal_id ~ '^user:[0-9a-fA-F-]{36}$'
      OR principal_id ~ '^api_key:[0-9a-fA-F-]{36}$'
    ),
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL CHECK (hit_count >= 0)
);

REVOKE ALL ON TABLE private.rate_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE private.rate_windows TO service_role;

CREATE OR REPLACE FUNCTION public.tradeguard_consume_rate_window(
  p_principal TEXT,
  p_limit INTEGER
)
RETURNS TABLE (allowed BOOLEAN, retry_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_count INTEGER;
  v_start TIMESTAMPTZ;
BEGIN
  IF p_principal IS NULL
     OR p_limit IS NULL
     OR p_limit < 1
     OR (
       p_principal !~ '^user:[0-9a-fA-F-]{36}$'
       AND p_principal !~ '^api_key:[0-9a-fA-F-]{36}$'
     ) THEN
    RAISE EXCEPTION 'invalid rate principal' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.rate_windows AS window_row (principal_id, window_started_at, hit_count)
  VALUES (p_principal, v_now, 1)
  ON CONFLICT (principal_id) DO UPDATE
  SET
    window_started_at = CASE
      WHEN window_row.window_started_at <= v_now - INTERVAL '60 seconds' THEN v_now
      ELSE window_row.window_started_at
    END,
    hit_count = CASE
      WHEN window_row.window_started_at <= v_now - INTERVAL '60 seconds' THEN 1
      ELSE window_row.hit_count + 1
    END
  RETURNING window_row.hit_count, window_row.window_started_at
  INTO v_count, v_start;

  IF v_count > p_limit THEN
    RETURN QUERY
    SELECT
      FALSE,
      GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (v_start + INTERVAL '60 seconds' - v_now)))::INTEGER
      );
  ELSE
    RETURN QUERY SELECT TRUE, 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tradeguard_consume_rate_window(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tradeguard_consume_rate_window(TEXT, INTEGER) TO service_role;

COMMIT;
