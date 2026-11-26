-- CoinTrac Hidden Gem Discovery Engine Schema (Phase 1)
-- Purely additive migration. Preserves all existing public/private tables.
-- Global market tables (hg_assets, hg_market_snapshots, hg_historical_cache) have no user_id.
-- User-scoped tables follow 004_tenant_scope.sql using user_id UUID REFERENCES auth.users(id)
-- and strict Row-Level Security via (SELECT auth.uid()).

BEGIN;

-- =========================================================
-- A. GLOBAL SHARED TABLES (No user_id; public market facts)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.hg_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_provider TEXT NOT NULL DEFAULT 'coinmarketcap',
  canonical_provider_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  identity_status TEXT NOT NULL
    CHECK (identity_status IN ('VERIFIED', 'UNRESOLVED', 'DELISTED', 'EXCLUDED')),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  date_added TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (canonical_provider, canonical_provider_id)
);

CREATE TABLE IF NOT EXISTS public.hg_market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_batch_id UUID NOT NULL,
  asset_id UUID NOT NULL REFERENCES public.hg_assets(id),
  quote_currency TEXT NOT NULL DEFAULT 'USD',
  price NUMERIC,
  market_cap NUMERIC,
  volume_24h NUMERIC,
  volume_change_24h NUMERIC,
  volume_to_mcap NUMERIC,
  num_market_pairs INTEGER,
  return_1h NUMERIC,
  return_4h NUMERIC,
  return_24h NUMERIC,
  return_7d NUMERIC,
  return_30d NUMERIC,
  return_60d NUMERIC,
  return_90d NUMERIC,
  rs_btc_7d NUMERIC,
  rs_btc_30d NUMERIC,
  rs_eth_7d NUMERIC,
  open_interest NUMERIC,
  funding_rate NUMERIC,
  source_provider TEXT NOT NULL DEFAULT 'coinmarketcap',
  source_timestamp TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_mode TEXT NOT NULL CHECK (data_mode IN ('LIVE', 'CACHED')),
  quality_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hg_historical_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.hg_assets(id),
  series_type TEXT NOT NULL
    CHECK (series_type IN ('QUOTES_DAILY', 'OHLCV_DAILY', 'OHLCV_1H')),
  bar_timestamp TIMESTAMPTZ NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC NOT NULL,
  volume NUMERIC,
  market_cap NUMERIC,
  source_provider TEXT NOT NULL DEFAULT 'coinmarketcap',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, series_type, bar_timestamp)
);

-- =========================================================
-- B. USER-SCOPED TABLES (Strict auth.uid() RLS required)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.hg_scan_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  discovery_track TEXT NOT NULL CHECK (discovery_track IN ('EARLY', 'CONFIRMED', 'BOTH')),
  trading_horizon TEXT NOT NULL CHECK (trading_horizon IN ('SHORT_TERM', 'SWING', 'BOTH')),
  universe_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  filter_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  scoring_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hg_scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id UUID REFERENCES public.hg_scan_configs(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')),
  discovery_track TEXT NOT NULL CHECK (discovery_track IN ('EARLY', 'CONFIRMED', 'BOTH')),
  trading_horizon TEXT NOT NULL CHECK (trading_horizon IN ('SHORT_TERM', 'SWING', 'BOTH')),
  effective_tier TEXT NOT NULL,
  evaluation_profile TEXT NOT NULL,
  baseline_mode TEXT NOT NULL DEFAULT 'HISTORICAL_BOOTSTRAP'
    CHECK (baseline_mode IN ('HISTORICAL_BOOTSTRAP', 'LIVE_SNAPSHOTS')),
  ingest_batch_id UUID,
  universe_requested INTEGER NOT NULL,
  universe_scanned INTEGER DEFAULT 0,
  candidates_discovered INTEGER DEFAULT 0,
  candidates_eligible INTEGER DEFAULT 0,
  candidates_rejected INTEGER DEFAULT 0,
  market_regime TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (market_regime IN (
      'RISK_ON_ALTSEASON',
      'BTC_LED_EXPANSION',
      'RANGE_CONSOLIDATION',
      'RISK_OFF_STRESS',
      'UNKNOWN'
    )),
  cmc_credits_consumed INTEGER NOT NULL DEFAULT 0,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  heartbeat_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.hg_candidate_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_run_id UUID NOT NULL REFERENCES public.hg_scan_runs(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.hg_assets(id),
  market_snapshot_id UUID NOT NULL REFERENCES public.hg_market_snapshots(id),
  discovery_track TEXT NOT NULL CHECK (discovery_track IN ('EARLY', 'CONFIRMED')),
  trading_horizon TEXT NOT NULL CHECK (trading_horizon IN ('SHORT_TERM', 'SWING')),
  raw_score NUMERIC,
  adjusted_score NUMERIC,
  valid_weight_coverage NUMERIC NOT NULL,
  confidence_level TEXT NOT NULL
    CHECK (confidence_level IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT')),
  data_confidence NUMERIC NOT NULL,
  signal_confidence NUMERIC NOT NULL,
  liquidity_confidence NUMERIC NOT NULL,
  liquidity_mode TEXT NOT NULL DEFAULT 'PROXY'
    CHECK (liquidity_mode IN ('PROXY', 'VERIFIED_ORDERBOOK')),
  classification TEXT NOT NULL CHECK (classification IN (
    'HIGH_QUALITY_CANDIDATE',
    'STRONG_CANDIDATE',
    'EMERGING_CANDIDATE',
    'WATCH',
    'LOW_PRIORITY',
    'INSUFFICIENT_DATA'
  )),
  eligibility_status TEXT NOT NULL
    CHECK (eligibility_status IN ('ELIGIBLE', 'WATCH', 'REJECTED', 'INSUFFICIENT_DATA')),
  score_version TEXT NOT NULL,
  component_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  penalties JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_components JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanation JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scan_run_id, asset_id, discovery_track, trading_horizon)
);

CREATE TABLE IF NOT EXISTS public.hg_candidate_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_result_id UUID NOT NULL
    REFERENCES public.hg_candidate_results(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  observed_value JSONB NOT NULL,
  interpretation TEXT NOT NULL,
  direction TEXT NOT NULL
    CHECK (direction IN ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MISSING')),
  source_provider TEXT NOT NULL,
  source_endpoint TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  quality_status TEXT NOT NULL
    CHECK (quality_status IN ('VALID', 'PARTIAL', 'UNKNOWN', 'STALE', 'INVALID')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hg_watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.hg_assets(id),
  candidate_result_id UUID
    REFERENCES public.hg_candidate_results(id) ON DELETE SET NULL,
  watch_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (watch_status IN ('ACTIVE', 'ARCHIVED')),
  user_note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset_id)
);

CREATE TABLE IF NOT EXISTS public.hg_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.hg_assets(id),
  scan_run_id UUID REFERENCES public.hg_scan_runs(id) ON DELETE SET NULL,
  candidate_result_id UUID
    REFERENCES public.hg_candidate_results(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'NEW_DISCOVERY',
    'SCORE_UPGRADE',
    'SCORE_DOWNGRADE',
    'CONFIRMATION',
    'RISK_ESCALATION',
    'INVALIDATION',
    'DATA_STALE',
    'WATCHLIST_CHANGE'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'MEDIUM', 'HIGH', 'CRITICAL')),
  dedup_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  delivery_channel TEXT NOT NULL DEFAULT 'IN_APP'
    CHECK (delivery_channel IN ('IN_APP', 'TELEGRAM')),
  delivery_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.hg_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.hg_assets(id),
  discovery_track TEXT NOT NULL CHECK (discovery_track IN ('EARLY', 'CONFIRMED')),
  trading_horizon TEXT NOT NULL CHECK (trading_horizon IN ('SHORT_TERM', 'SWING')),
  candidate_result_id UUID NOT NULL
    REFERENCES public.hg_candidate_results(id) ON DELETE CASCADE,
  previous_score NUMERIC,
  current_score NUMERIC,
  score_delta NUMERIC,
  previous_status TEXT,
  current_status TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hg_scan_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_run_id UUID NOT NULL REFERENCES public.hg_scan_runs(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.hg_assets(id),
  rejection_stage TEXT NOT NULL,
  rejection_code TEXT NOT NULL,
  rejection_reason TEXT NOT NULL,
  observed_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hg_outcome_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_result_id UUID NOT NULL
    REFERENCES public.hg_candidate_results(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.hg_assets(id),
  discovery_track TEXT NOT NULL CHECK (discovery_track IN ('EARLY', 'CONFIRMED')),
  trading_horizon TEXT NOT NULL CHECK (trading_horizon IN ('SHORT_TERM', 'SWING')),
  score_version TEXT NOT NULL,
  entry_price NUMERIC NOT NULL,
  entry_btc_price NUMERIC NOT NULL,
  entry_observed_at TIMESTAMPTZ NOT NULL,
  ret_1d NUMERIC,
  ret_3d NUMERIC,
  ret_7d NUMERIC,
  ret_14d NUMERIC,
  ret_30d NUMERIC,
  rel_btc_7d NUMERIC,
  rel_btc_30d NUMERIC,
  mfe_30d NUMERIC,
  mae_30d NUMERIC,
  invalidated_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ,
  UNIQUE (candidate_result_id)
);

-- =========================================================
-- C. INDEXES & PARTIAL INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_hg_snapshots_asset_obs
  ON public.hg_market_snapshots (asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_hg_snapshots_batch
  ON public.hg_market_snapshots (ingest_batch_id);
CREATE INDEX IF NOT EXISTS idx_hg_hist_asset_type_ts
  ON public.hg_historical_cache (asset_id, series_type, bar_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_hg_runs_user_created
  ON public.hg_scan_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hg_runs_running_hb
  ON public.hg_scan_runs (status, heartbeat_at) WHERE status = 'RUNNING';

CREATE INDEX IF NOT EXISTS idx_hg_results_user_run
  ON public.hg_candidate_results (user_id, scan_run_id);
CREATE INDEX IF NOT EXISTS idx_hg_results_user_asset
  ON public.hg_candidate_results (user_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_hg_results_user_track
  ON public.hg_candidate_results (user_id, discovery_track, trading_horizon);
CREATE INDEX IF NOT EXISTS idx_hg_results_user_class
  ON public.hg_candidate_results (user_id, classification);
CREATE INDEX IF NOT EXISTS idx_hg_results_user_elig
  ON public.hg_candidate_results (user_id, eligibility_status);

CREATE INDEX IF NOT EXISTS idx_hg_evidence_candidate
  ON public.hg_candidate_evidence (candidate_result_id);
CREATE INDEX IF NOT EXISTS idx_hg_rejections_run_stage
  ON public.hg_scan_rejections (scan_run_id, rejection_stage);
CREATE INDEX IF NOT EXISTS idx_hg_history_user_asset
  ON public.hg_score_history (user_id, asset_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_hg_watchlist_active
  ON public.hg_watchlist_items (user_id, updated_at DESC)
  WHERE watch_status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_hg_alerts_pending
  ON public.hg_alert_events (user_id, created_at ASC)
  WHERE delivery_status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_hg_alerts_dedup
  ON public.hg_alert_events (user_id, dedup_key, created_at DESC);

-- =========================================================
-- D. STRICT ROW-LEVEL SECURITY (004_tenant_scope pattern)
-- =========================================================

-- Global shared tables: read-only for authenticated users; writes strictly service_role.
ALTER TABLE public.hg_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hg_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hg_market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hg_market_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hg_historical_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hg_historical_cache FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hg_assets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hg_market_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hg_historical_cache FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.hg_assets TO authenticated;
GRANT SELECT ON TABLE public.hg_market_snapshots TO authenticated;
GRANT SELECT ON TABLE public.hg_historical_cache TO authenticated;

GRANT ALL ON TABLE public.hg_assets TO service_role;
GRANT ALL ON TABLE public.hg_market_snapshots TO service_role;
GRANT ALL ON TABLE public.hg_historical_cache TO service_role;

CREATE POLICY hg_assets_read_authenticated
  ON public.hg_assets FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY hg_market_snapshots_read_authenticated
  ON public.hg_market_snapshots FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY hg_historical_cache_read_authenticated
  ON public.hg_historical_cache FOR SELECT TO authenticated USING (TRUE);

-- User-scoped tables: strict user_id = (SELECT auth.uid()).
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'hg_scan_configs',
    'hg_scan_runs',
    'hg_candidate_results',
    'hg_candidate_evidence',
    'hg_watchlist_items',
    'hg_alert_events',
    'hg_score_history',
    'hg_scan_rejections',
    'hg_outcome_checkpoints'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', tbl);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      tbl
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (user_id = (SELECT auth.uid()))',
      tbl || '_user_select', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
      'WITH CHECK (user_id = (SELECT auth.uid()))',
      tbl || '_user_insert', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
      'USING (user_id = (SELECT auth.uid())) '
      'WITH CHECK (user_id = (SELECT auth.uid()))',
      tbl || '_user_update', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
      'USING (user_id = (SELECT auth.uid()))',
      tbl || '_user_delete', tbl
    );
  END LOOP;
END;
$$;

COMMIT;
