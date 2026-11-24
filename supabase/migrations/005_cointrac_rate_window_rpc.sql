-- R6 Legacy Namespace Migration — Additive CoinTrac Rate-Window RPC.
-- STATUS: PREPARED IN PHASE 3 — DO NOT EXECUTE WITHOUT EXPLICIT PHASE 4 APPROVAL.
-- Target Environment (Phase 4 ONLY): CoinTrac DEVELOPMENT (fflwfpmbyykyxhlhikwc) ONLY.
-- NEVER apply to Production or unrelated project udprwjbmrfknulngsjid.
--
-- Compatibility guarantees:
-- 1. Purely additive: leaves public.tradeguard_consume_rate_window untouched during transition.
-- 2. Shares the exact same backing table (private.rate_windows) so concurrent requests via
--    either old or new RPC enforce one unified quota window with zero double-counting.
-- 3. Preserves exact argument types, return table shape, SECURITY DEFINER, SET search_path = '',
--    and service_role-only EXECUTE grant.

BEGIN;

CREATE OR REPLACE FUNCTION public.cointrac_consume_rate_window(
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

REVOKE ALL ON FUNCTION public.cointrac_consume_rate_window(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cointrac_consume_rate_window(TEXT, INTEGER) TO service_role;

COMMIT;
