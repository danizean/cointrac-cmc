-- Stage 4.3: Populate verified CoinMarketCap canonical category IDs for 6 sectors.
-- Verified read-only against GET /v1/cryptocurrency/categories?limit=1000 (2026-11-23T08:50Z).
--
-- Safety guarantees:
--   1. Idempotent: safe to re-run; only updates cmc_category_id when distinct.
--   2. Preserves existing display_name and fallback_tags on conflict.
--   3. Keeps 'rwa' explicitly unmapped (cmc_category_id remains NULL).
--   4. Does NOT map CMC v5 RWA assets into crypto sector membership.
--   5. Does NOT touch api_keys, market_assets, cmc_snapshots, evidence_records, or request_logs.

BEGIN;

INSERT INTO sector_mappings (sector_slug, display_name, cmc_category_id, fallback_tags)
VALUES
  ('defi', 'DeFi', '5fb62883c9ddcc213ed13308', ARRAY['defi', 'decentralized-finance']),
  ('ai-big-data', 'AI & Big Data', '6051a81a66fc1b42617d6db7', ARRAY['ai-big-data', 'artificial-intelligence']),
  ('layer-1', 'Layer 1', '6433de7df79a2653906cd680', ARRAY['layer-1']),
  ('layer-2', 'Layer 2', '604f2776ebccdd50cd175fdc', ARRAY['layer-2', 'scaling']),
  ('gaming', 'Gaming', '6051a82166fc1b42617d6dc1', ARRAY['gaming', 'gamefi']),
  ('memes', 'Memecoins', '6051a82566fc1b42617d6dc6', ARRAY['memes', 'meme'])
ON CONFLICT (sector_slug) DO UPDATE
SET
  cmc_category_id = EXCLUDED.cmc_category_id,
  updated_at = NOW()
WHERE sector_mappings.cmc_category_id IS DISTINCT FROM EXCLUDED.cmc_category_id;

COMMIT;
