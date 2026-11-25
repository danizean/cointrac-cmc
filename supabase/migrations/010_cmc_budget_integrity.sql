-- Proposal migration. DO NOT APPLY without owner approval.
-- Depends on 008_cmc_usage_budget.sql when that table already exists.
-- Safe to apply on a database that does not have cmc_usage yet.
--
-- Purpose:
--   Aggregate the server-key ledger with SUM and COUNT inside Postgres.
--   Reserve credits under a transaction advisory lock before an upstream call.
--   Reconcile the reservation from CMC status.credit_count without a second row.
--
-- The month window is computed from the database clock in UTC. The caller cannot
-- pass a short window that would hide earlier spend.
--
-- Rollback (only after confirming no process still calls these functions):
--   DROP FUNCTION IF EXISTS public.cointrac_cmc_budget_totals();
--   DROP FUNCTION IF EXISTS public.cointrac_reconcile_cmc_credit(text, text, integer, text, integer, text, text, text, integer);
--   DROP FUNCTION IF EXISTS public.cointrac_reserve_cmc_credit(text, text, integer, integer, text, text, text, integer);
--   DROP INDEX IF EXISTS public.uq_cmc_usage_idempotency_key;
--   ALTER TABLE public.cmc_usage DROP CONSTRAINT IF EXISTS cmc_usage_credit_status_chk;
--   ALTER TABLE public.cmc_usage DROP CONSTRAINT IF EXISTS cmc_usage_caller_chk;
--   GRANT INSERT, UPDATE, DELETE ON TABLE public.cmc_usage TO service_role;

BEGIN;

CREATE TABLE IF NOT EXISTS public.cmc_usage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint text NOT NULL,
    credit_cost integer NOT NULL CHECK (credit_cost >= 0),
    cache_status text NOT NULL DEFAULT 'MISS'
        CHECK (cache_status IN ('MISS', 'WARMER_MISS', 'REFRESH')),
    error_category text NULL
        CHECK (
            error_category IS NULL
            OR error_category IN (
                'auth_invalid',
                'tier_restricted',
                'rate_limited',
                'transient_error',
                'client_error'
            )
        ),
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.cmc_usage ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.cmc_usage ADD COLUMN IF NOT EXISTS credit_status text;
ALTER TABLE public.cmc_usage ADD COLUMN IF NOT EXISTS reservation_credits integer;
ALTER TABLE public.cmc_usage ADD COLUMN IF NOT EXISTS released boolean;
ALTER TABLE public.cmc_usage ADD COLUMN IF NOT EXISTS caller text;
ALTER TABLE public.cmc_usage ADD COLUMN IF NOT EXISTS attempt_no integer;

UPDATE public.cmc_usage
SET
    idempotency_key = COALESCE(idempotency_key, id::text),
    credit_status = COALESCE(credit_status, 'known'),
    reservation_credits = COALESCE(reservation_credits, credit_cost, 0),
    released = COALESCE(released, false),
    caller = COALESCE(caller, 'user'),
    attempt_no = COALESCE(attempt_no, 1)
WHERE idempotency_key IS NULL
   OR credit_status IS NULL
   OR reservation_credits IS NULL
   OR released IS NULL
   OR caller IS NULL
   OR attempt_no IS NULL;

ALTER TABLE public.cmc_usage ALTER COLUMN credit_status SET DEFAULT 'known';
ALTER TABLE public.cmc_usage ALTER COLUMN reservation_credits SET DEFAULT 0;
ALTER TABLE public.cmc_usage ALTER COLUMN released SET DEFAULT false;
ALTER TABLE public.cmc_usage ALTER COLUMN caller SET DEFAULT 'user';
ALTER TABLE public.cmc_usage ALTER COLUMN attempt_no SET DEFAULT 1;

ALTER TABLE public.cmc_usage ALTER COLUMN idempotency_key SET NOT NULL;
ALTER TABLE public.cmc_usage ALTER COLUMN credit_status SET NOT NULL;
ALTER TABLE public.cmc_usage ALTER COLUMN reservation_credits SET NOT NULL;
ALTER TABLE public.cmc_usage ALTER COLUMN released SET NOT NULL;
ALTER TABLE public.cmc_usage ALTER COLUMN caller SET NOT NULL;
ALTER TABLE public.cmc_usage ALTER COLUMN attempt_no SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'cmc_usage_credit_status_chk'
          AND conrelid = 'public.cmc_usage'::pg_catalog.regclass
    ) THEN
        ALTER TABLE public.cmc_usage
            ADD CONSTRAINT cmc_usage_credit_status_chk
            CHECK (credit_status IN ('reserved', 'known', 'unknown'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'cmc_usage_caller_chk'
          AND conrelid = 'public.cmc_usage'::pg_catalog.regclass
    ) THEN
        ALTER TABLE public.cmc_usage
            ADD CONSTRAINT cmc_usage_caller_chk
            CHECK (caller IN ('user', 'warmer'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cmc_usage_idempotency_key
    ON public.cmc_usage (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_cmc_usage_created_at
    ON public.cmc_usage (created_at DESC);

COMMENT ON TABLE public.cmc_usage IS
    'Server-key CMC ledger. Committed spend is SUM of known credits plus open reserved and unknown holds. Cache hits and BYOK are absent. Not a tenant table.';

ALTER TABLE public.cmc_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmc_usage FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cmc_usage FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cmc_usage FROM service_role;
GRANT SELECT ON TABLE public.cmc_usage TO service_role;

CREATE OR REPLACE FUNCTION public.cointrac_cmc_budget_totals()
RETURNS TABLE (
    credits_committed bigint,
    upstream_calls bigint,
    warmer_credits bigint,
    billing_month_utc text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_start timestamptz;
    v_end timestamptz;
BEGIN
    v_start := pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
    v_end := v_start + INTERVAL '1 month';
    RETURN QUERY
    SELECT
        COALESCE(SUM(
            CASE
                WHEN usage_row.released THEN 0
                WHEN usage_row.credit_status = 'known' THEN usage_row.credit_cost
                ELSE usage_row.reservation_credits
            END
        ), 0)::bigint,
        COUNT(*)::bigint,
        COALESCE(SUM(
            CASE
                WHEN usage_row.cache_status = 'WARMER_MISS' AND NOT usage_row.released THEN
                    CASE
                        WHEN usage_row.credit_status = 'known' THEN usage_row.credit_cost
                        ELSE usage_row.reservation_credits
                    END
                ELSE 0
            END
        ), 0)::bigint,
        pg_catalog.to_char(v_start AT TIME ZONE 'utc', 'YYYY-MM')
    FROM public.cmc_usage AS usage_row
    WHERE usage_row.created_at >= v_start
      AND usage_row.created_at < v_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.cointrac_reserve_cmc_credit(
    p_idempotency_key text,
    p_endpoint text,
    p_reservation_credits integer,
    p_monthly_budget integer,
    p_priority text,
    p_cache_status text,
    p_caller text,
    p_attempt_no integer
)
RETURNS TABLE (
    allowed boolean,
    state text,
    warning_level text,
    credits_committed integer,
    warmer_credits integer,
    idempotency_key text,
    reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_start timestamptz;
    v_end timestamptz;
    v_credits integer := 0;
    v_warmer integer := 0;
    v_state text;
    v_warning text;
    v_existing_status text;
    v_existing_released boolean;
    v_existing_hold integer;
    v_allowed boolean := false;
    v_reason text := NULL;
    v_ceiling integer;
BEGIN
    IF p_idempotency_key IS NULL
       OR pg_catalog.length(p_idempotency_key) < 8
       OR pg_catalog.length(p_idempotency_key) > 128
       OR p_idempotency_key !~ '^[A-Za-z0-9:_-]+$'
       OR p_endpoint IS NULL
       OR pg_catalog.length(p_endpoint) < 2
       OR pg_catalog.length(p_endpoint) > 200
       OR p_reservation_credits IS NULL
       OR p_reservation_credits < 1
       OR p_reservation_credits > 100
       OR p_monthly_budget IS NULL
       OR p_monthly_budget < 1
       OR p_monthly_budget > 100000000
       OR p_priority NOT IN ('core_warmer', 'standard', 'expensive')
       OR p_cache_status NOT IN ('MISS', 'WARMER_MISS', 'REFRESH')
       OR p_caller NOT IN ('user', 'warmer')
       OR p_attempt_no IS NULL
       OR p_attempt_no < 1
    THEN
        RAISE EXCEPTION 'invalid cmc reservation' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        847291,
        pg_catalog.hashtext(pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'utc', 'YYYY-MM'))
    );

    v_start := pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
    v_end := v_start + INTERVAL '1 month';

    SELECT
        COALESCE(SUM(
            CASE
                WHEN usage_row.released THEN 0
                WHEN usage_row.credit_status = 'known' THEN usage_row.credit_cost
                ELSE usage_row.reservation_credits
            END
        ), 0)::integer,
        COALESCE(SUM(
            CASE
                WHEN usage_row.cache_status = 'WARMER_MISS' AND NOT usage_row.released THEN
                    CASE
                        WHEN usage_row.credit_status = 'known' THEN usage_row.credit_cost
                        ELSE usage_row.reservation_credits
                    END
                ELSE 0
            END
        ), 0)::integer
    INTO v_credits, v_warmer
    FROM public.cmc_usage AS usage_row
    WHERE usage_row.created_at >= v_start
      AND usage_row.created_at < v_end;

    IF v_credits >= p_monthly_budget THEN
        v_state := 'CUTOFF';
        v_warning := 'CUTOFF';
    ELSIF v_credits * 100 >= p_monthly_budget * 95 THEN
        v_state := 'EMERGENCY';
        v_warning := 'EMERGENCY';
    ELSIF v_credits * 100 >= p_monthly_budget * 85 THEN
        v_state := 'CONSERVATION';
        v_warning := 'CONSERVATION';
    ELSIF v_credits * 100 >= p_monthly_budget * 70 THEN
        v_state := 'NORMAL';
        v_warning := 'ELEVATED';
    ELSE
        v_state := 'NORMAL';
        v_warning := 'NONE';
    END IF;

    SELECT usage_row.credit_status, usage_row.released, usage_row.reservation_credits
    INTO v_existing_status, v_existing_released, v_existing_hold
    FROM public.cmc_usage AS usage_row
    WHERE usage_row.idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_released THEN
            RETURN QUERY
            SELECT false, 'CUTOFF'::text, 'CUTOFF'::text, v_credits, v_warmer,
                   p_idempotency_key, 'Reservation was already released.'::text;
            RETURN;
        END IF;
        RETURN QUERY
        SELECT true, v_state, v_warning, v_credits, v_warmer, p_idempotency_key, NULL::text;
        RETURN;
    END IF;

    v_ceiling := (p_monthly_budget * 40) / 100;
    IF p_caller = 'warmer' AND v_warmer + p_reservation_credits > v_ceiling THEN
        v_allowed := false;
        v_reason := 'Server-key warmer is at its credit ceiling so user requests keep a reserve.';
    ELSIF v_state = 'CUTOFF' OR v_credits + p_reservation_credits > p_monthly_budget THEN
        v_allowed := false;
        v_state := 'CUTOFF';
        v_warning := 'CUTOFF';
        v_reason := 'Server-key CMC credit budget reached CUTOFF.';
    ELSIF v_state = 'EMERGENCY' AND NOT (
        p_priority = 'core_warmer'
        AND p_endpoint IN (
            '/v1/cryptocurrency/listings/latest',
            '/v1/global-metrics/quotes/latest',
            '/v3/fear-and-greed/latest',
            '/v1/cryptocurrency/map'
        )
    ) THEN
        v_allowed := false;
        v_reason := 'Server-key CMC credit budget is in EMERGENCY.';
    ELSIF v_state = 'CONSERVATION' AND (
        p_priority = 'expensive'
        OR p_endpoint IN (
            '/v1/cryptocurrency/categories',
            '/v1/cryptocurrency/category',
            '/v2/cryptocurrency/ohlcv/historical',
            '/v2/cryptocurrency/price-performance-stats/latest',
            '/v5/cryptocurrency/derivatives/market-pairs/list/latest',
            '/v5/derivatives/liquidations/quotes/latest',
            '/v5/exchange/derivatives/list',
            '/v5/real-world-assets/assets/list',
            '/v5/real-world-assets/map',
            '/v2/cryptocurrency/info'
        )
    ) THEN
        v_allowed := false;
        v_reason := 'Server-key CMC budget is in CONSERVATION.';
    ELSE
        v_allowed := true;
    END IF;

    IF v_allowed THEN
        INSERT INTO public.cmc_usage (
            endpoint,
            credit_cost,
            cache_status,
            error_category,
            idempotency_key,
            credit_status,
            reservation_credits,
            released,
            caller,
            attempt_no
        ) VALUES (
            p_endpoint,
            p_reservation_credits,
            p_cache_status,
            NULL,
            p_idempotency_key,
            'reserved',
            p_reservation_credits,
            false,
            p_caller,
            p_attempt_no
        );
        v_credits := v_credits + p_reservation_credits;
    END IF;

    RETURN QUERY
    SELECT v_allowed, v_state, v_warning, v_credits, v_warmer, p_idempotency_key, v_reason;
END;
$$;

CREATE OR REPLACE FUNCTION public.cointrac_reconcile_cmc_credit(
    p_idempotency_key text,
    p_outcome text,
    p_actual_credits integer,
    p_error_category text,
    p_reservation_credits integer,
    p_endpoint text,
    p_cache_status text,
    p_caller text,
    p_attempt_no integer
)
RETURNS TABLE (
    credit_status text,
    credit_cost integer,
    released boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text;
    v_released boolean;
    v_hold integer;
    v_outcome text := p_outcome;
BEGIN
    IF p_idempotency_key IS NULL
       OR p_outcome NOT IN ('known', 'unknown', 'released')
       OR p_reservation_credits IS NULL
       OR p_reservation_credits < 0
       OR p_reservation_credits > 100
       OR (p_error_category IS NOT NULL AND p_error_category NOT IN (
            'auth_invalid', 'tier_restricted', 'rate_limited', 'transient_error', 'client_error'
       ))
    THEN
        RAISE EXCEPTION 'invalid cmc reconciliation' USING ERRCODE = '22023';
    END IF;

    IF v_outcome = 'known' AND (p_actual_credits IS NULL OR p_actual_credits < 0) THEN
        v_outcome := 'unknown';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        847291,
        pg_catalog.hashtext(pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'utc', 'YYYY-MM'))
    );

    SELECT usage_row.credit_status, usage_row.released, usage_row.reservation_credits
    INTO v_status, v_released, v_hold
    FROM public.cmc_usage AS usage_row
    WHERE usage_row.idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
        IF v_outcome = 'released' THEN
            RETURN QUERY SELECT 'reserved'::text, 0, true;
            RETURN;
        END IF;
        INSERT INTO public.cmc_usage (
            endpoint, credit_cost, cache_status, error_category, idempotency_key,
            credit_status, reservation_credits, released, caller, attempt_no
        ) VALUES (
            COALESCE(p_endpoint, '/unknown'),
            CASE WHEN v_outcome = 'known' THEN p_actual_credits ELSE p_reservation_credits END,
            COALESCE(p_cache_status, 'MISS'),
            p_error_category,
            p_idempotency_key,
            CASE WHEN v_outcome = 'known' THEN 'known' ELSE 'unknown' END,
            p_reservation_credits,
            false,
            COALESCE(p_caller, 'user'),
            COALESCE(p_attempt_no, 1)
        );
        RETURN QUERY
        SELECT
            CASE WHEN v_outcome = 'known' THEN 'known' ELSE 'unknown' END,
            CASE WHEN v_outcome = 'known' THEN p_actual_credits ELSE p_reservation_credits END,
            false;
        RETURN;
    END IF;

    IF v_released OR v_status = 'known' THEN
        RETURN QUERY
        SELECT v_status, CASE WHEN v_released THEN 0 ELSE v_hold END, v_released;
        RETURN;
    END IF;

    IF v_status = 'unknown' AND v_outcome = 'released' THEN
        RETURN QUERY SELECT 'unknown'::text, v_hold, false;
        RETURN;
    END IF;

    IF v_outcome = 'released' THEN
        UPDATE public.cmc_usage AS usage_row
        SET released = true, credit_cost = 0, error_category = COALESCE(p_error_category, usage_row.error_category)
        WHERE usage_row.idempotency_key = p_idempotency_key;
        RETURN QUERY SELECT 'reserved'::text, 0, true;
        RETURN;
    END IF;

    IF v_outcome = 'unknown' THEN
        UPDATE public.cmc_usage AS usage_row
        SET
            credit_status = 'unknown',
            credit_cost = usage_row.reservation_credits,
            error_category = COALESCE(p_error_category, usage_row.error_category)
        WHERE usage_row.idempotency_key = p_idempotency_key;
        RETURN QUERY SELECT 'unknown'::text, v_hold, false;
        RETURN;
    END IF;

    UPDATE public.cmc_usage AS usage_row
    SET
        credit_status = 'known',
        credit_cost = p_actual_credits,
        error_category = p_error_category
    WHERE usage_row.idempotency_key = p_idempotency_key;
    RETURN QUERY SELECT 'known'::text, p_actual_credits, false;
END;
$$;

REVOKE ALL ON FUNCTION public.cointrac_cmc_budget_totals()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cointrac_reserve_cmc_credit(text, text, integer, integer, text, text, text, integer)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cointrac_reconcile_cmc_credit(text, text, integer, text, integer, text, text, text, integer)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cointrac_cmc_budget_totals() TO service_role;
GRANT EXECUTE ON FUNCTION public.cointrac_reserve_cmc_credit(text, text, integer, integer, text, text, text, integer)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.cointrac_reconcile_cmc_credit(text, text, integer, text, integer, text, text, text, integer)
    TO service_role;

COMMIT;
