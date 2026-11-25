-- Proposal migration for Tahap 1 (Basic Tier Hardening)
-- DO NOT APPLY automatically without owner approval.
-- Stores actual upstream CoinMarketCap API calls and credit costs from `status.credit_count`.
-- Cache hits (L1/L2) and private BYOK requests MUST NOT be recorded in this server-key budget table.

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
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmc_usage_created_at
    ON public.cmc_usage (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cmc_usage_endpoint_created_at
    ON public.cmc_usage (endpoint, created_at DESC);

COMMENT ON TABLE public.cmc_usage IS
    'Server-key upstream CoinMarketCap API usage ledger for monthly credit budget control. Excludes cache hits and BYOK requests.';

ALTER TABLE public.cmc_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmc_usage FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cmc_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cmc_usage TO service_role;
