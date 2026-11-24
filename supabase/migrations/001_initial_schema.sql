CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limit_per_min INT NOT NULL DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_assets (
  cmc_id INT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  rank INT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_market_assets_symbol ON market_assets (UPPER(symbol));
CREATE INDEX IF NOT EXISTS idx_market_assets_slug ON market_assets (slug);

CREATE TABLE IF NOT EXISTS cmc_snapshots (
  id BIGSERIAL PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL,
  source_timestamp TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_seconds INT NOT NULL DEFAULT 120,
  credit_cost INT NOT NULL DEFAULT 0,
  is_verified_fallback BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_cmc_snapshots_endpoint_time
  ON cmc_snapshots (endpoint, retrieved_at DESC);

CREATE TABLE IF NOT EXISTS evidence_records (
  evidence_id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  asset_cmc_ids INT[] NOT NULL DEFAULT '{}',
  endpoints_called TEXT[] NOT NULL DEFAULT '{}',
  data_mode TEXT NOT NULL CHECK (data_mode IN ('LIVE', 'CACHED', 'VERIFIED_SNAPSHOT_FALLBACK')),
  freshness TEXT NOT NULL CHECK (freshness IN ('FRESH', 'AGING', 'STALE')),
  credit_cost INT NOT NULL DEFAULT 0,
  engine_version TEXT NOT NULL,
  methodology JSONB NOT NULL DEFAULT '{}'::jsonb,
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_excerpt JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_created ON evidence_records (created_at DESC);

CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  surface TEXT NOT NULL CHECK (surface IN ('mcp', 'rest', 'playground')),
  tool_name TEXT NOT NULL,
  status_code INT NOT NULL,
  latency_ms INT NOT NULL,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  credit_cost INT NOT NULL DEFAULT 0,
  evidence_id TEXT REFERENCES evidence_records(evidence_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS sector_mappings (
  sector_slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  cmc_category_id TEXT,
  fallback_tags TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmc_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_mappings ENABLE ROW LEVEL SECURITY;
