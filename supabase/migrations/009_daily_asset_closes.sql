-- Proposal migration for Tahap 1 (Basic Tier Hardening)
-- DO NOT APPLY automatically without owner approval.
-- Stores observed daily reference close snapshots keyed by canonical CoinMarketCap numeric cmc_id
-- and UTC date. Never backfilled or fabricated; represents observed listings snapshot reference
-- prices rather than official CMC OHLCV closes.

CREATE TABLE IF NOT EXISTS public.daily_asset_closes (
    cmc_id integer NOT NULL CHECK (cmc_id > 0),
    utc_date date NOT NULL,
    close_price double precision NOT NULL CHECK (close_price > 0),
    market_cap double precision NULL CHECK (market_cap IS NULL OR market_cap >= 0),
    volume_24h double precision NULL CHECK (volume_24h IS NULL OR volume_24h >= 0),
    source text NOT NULL DEFAULT 'cmc_listings_snapshot_observed_reference',
    observed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cmc_id, utc_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_asset_closes_utc_date
    ON public.daily_asset_closes (utc_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_asset_closes_cmc_id_utc_date
    ON public.daily_asset_closes (cmc_id, utc_date DESC);

COMMENT ON TABLE public.daily_asset_closes IS
    'Observed daily asset reference prices captured idempotently from verified Top-200 CMC listings snapshots. Keyed by canonical cmc_id + utc_date; not official CMC OHLCV.';

ALTER TABLE public.daily_asset_closes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_asset_closes FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.daily_asset_closes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_asset_closes TO service_role;
