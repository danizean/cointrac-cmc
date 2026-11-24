INSERT INTO api_keys (key_prefix, key_hash, label, is_sandbox, rate_limit_per_min)
VALUES (
  'tg_sandbox_',
  encode(digest('tg_sandbox_buildwithcmc_2026', 'sha256'), 'hex'),
  'Sandbox',
  TRUE,
  30
)
ON CONFLICT (key_hash) DO NOTHING;

INSERT INTO sector_mappings (sector_slug, display_name, cmc_category_id, fallback_tags)
VALUES
  ('defi', 'DeFi', '5fb62883c9ddcc213ed13308', ARRAY['defi', 'decentralized-finance']),
  ('ai-big-data', 'AI & Big Data', '6051a81a66fc1b42617d6db7', ARRAY['ai-big-data', 'artificial-intelligence']),
  ('layer-1', 'Layer 1', '6433de7df79a2653906cd680', ARRAY['layer-1']),
  ('layer-2', 'Layer 2', '604f2776ebccdd50cd175fdc', ARRAY['layer-2', 'scaling']),
  ('gaming', 'Gaming', '6051a82166fc1b42617d6dc1', ARRAY['gaming', 'gamefi']),
  ('rwa', 'Real World Assets', NULL, ARRAY['real-world-assets', 'tokenized-assets']),
  ('memes', 'Memecoins', '6051a82566fc1b42617d6dc6', ARRAY['memes', 'meme'])
ON CONFLICT (sector_slug) DO NOTHING;
