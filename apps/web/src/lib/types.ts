export type EvidenceStatus =
  | "OK"
  | "PARTIAL"
  | "TIER_RESTRICTED"
  | "INSUFFICIENT_DATA";

export type DataMode =
  | "LIVE"
  | "CACHED"
  | "VERIFIED_SNAPSHOT_FALLBACK"
  | "UNAVAILABLE";

export type Freshness = "FRESH" | "AGING" | "STALE";

export type SectorSlug =
  | "defi"
  | "ai-big-data"
  | "layer-1"
  | "layer-2"
  | "gaming"
  | "rwa"
  | "memes";

export type RankBy =
  | "composite_momentum_score"
  | "rs_vs_btc_7d"
  | "volume_to_mcap";

export type RegimeLabel =
  | "RISK_ON_ALTSEASON"
  | "BTC_LED_EXPANSION"
  | "RISK_OFF_STRESS"
  | "RANGE_CONSOLIDATION";

export type RegimeConfidence = "HIGH" | "MEDIUM" | "LOW";

export type TaxonomySource = "cmc_category" | "listings_tag_fallback";

export type RotationSignal =
  | "GAINING_MOMENTUM"
  | "LEADING"
  | "LAGGING"
  | "WEAKENING"
  | "NEUTRAL"
  | "INSUFFICIENT_DATA";

export type MultiHorizonRisk =
  | "RECENT_MOMENTUM"
  | "EXTENDED_RALLY"
  | "SHARP_RETRACEMENT"
  | "POTENTIAL_EXHAUSTION"
  | "NEUTRAL"
  | "INSUFFICIENT_HISTORY";

export type AnomalyDirection =
  | "HIGH_VOLUME_TO_MCAP"
  | "LOW_VOLUME_ILLIQUIDITY"
  | "INSUFFICIENT_DATA";

export interface MethodologyMeta {
  metrics: string[];
  observation_window: string;
  annualization_basis: string;
}

export interface EvidenceMeta {
  evidence_id: string;
  data_mode: DataMode;
  freshness: Freshness;
  retrieved_at_utc: string;
  source_timestamps: Record<string, string>;
  cmc_endpoints_called: string[];
  cmc_credit_cost: number;
  cache_hit: boolean;
}

export interface EvidenceEnvelope<T = unknown> {
  tool: string;
  engine_version: string;
  status: EvidenceStatus;
  summary: string;
  data: T;
  methodology: MethodologyMeta;
  evidence: EvidenceMeta;
  limitations: string[];
}

export interface QuoteBrief {
  cmc_id: number | null;
  symbol: string;
  name: string | null;
  price: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  percent_change_24h: number | null;
}

export interface MarketOverviewData {
  quote_currency: string;
  total_market_cap: number | null;
  total_volume_24h: number | null;
  total_market_cap_change_24h_pct: number | null;
  btc_dominance: number | null;
  eth_dominance: number | null;
  btc_dominance_change_24h: number | null;
  fear_greed_value: number | null;
  fear_greed_classification: string | null;
  top50_breadth_positive_pct: number | null;
  btc: QuoteBrief | null;
  eth: QuoteBrief | null;
  sol: QuoteBrief | null;
  top_gainers: QuoteBrief[];
  top_losers: QuoteBrief[];
}

export interface ScanMoversInput {
  quote_currency?: string;
  min_market_cap_usd?: number | null;
  min_volume_24h_usd?: number | null;
  min_vol_to_mcap?: number | null;
  min_rs_vs_btc_7d?: number | null;
  max_24h_gain_pct?: number | null;
  max_7d_gain_pct?: number | null;
  rank_by?: RankBy;
  limit?: number;
  universe_size?: number;
}

export interface MoverRow {
  cmc_id: number | null;
  symbol: string;
  name: string | null;
  market_cap: number | null;
  volume_24h: number | null;
  volume_to_mcap: number | null;
  percent_change_24h: number | null;
  percent_change_7d?: number | null;
  percent_change_30d?: number | null;
  percent_change_60d?: number | null;
  rs_vs_btc_7d: number | null;
  composite_momentum_score: number | null;
  timeframes_available?: number | null;
  multi_horizon_risk?: MultiHorizonRisk | null;
}

export interface ScanMoversData {
  quote_currency: string;
  rank_by: RankBy;
  movers: MoverRow[];
}

export interface CompareAssetsInput {
  symbols: string[];
  quote_currency?: string;
}

export interface AssetComparison {
  cmc_id: number | null;
  symbol: string;
  name: string | null;
  price: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  volume_to_mcap: number | null;
  fdv_to_mcap_ratio: number | null;
  circulating_supply_pct: number | null;
  percent_change_24h: number | null;
  percent_change_7d: number | null;
  percent_change_30d: number | null;
  percent_change_60d?: number | null;
  rs_vs_btc_24h: number | null;
  rs_vs_btc_7d: number | null;
  rs_vs_btc_30d: number | null;
  composite_momentum_score: number | null;
  timeframes_available?: number | null;
  annualized_volatility: number | null;
  max_drawdown: number | null;
}

export interface CompareAssetsData {
  quote_currency: string;
  assets: AssetComparison[];
}

export interface PricePerformance {
  period: string;
  high: number | null;
  low: number | null;
  percent_change: number | null;
}

export interface AnalyzeAssetData {
  symbol: string;
  cmc_id: number | null;
  name: string | null;
  quote_currency: string;
  price: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  volume_to_mcap: number | null;
  fdv_to_mcap_ratio: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  circulating_supply_pct: number | null;
  tags: string[];
  percent_change_24h: number | null;
  percent_change_7d: number | null;
  percent_change_30d: number | null;
  percent_change_60d?: number | null;
  rs_vs_btc_24h: number | null;
  rs_vs_btc_7d: number | null;
  rs_vs_btc_30d: number | null;
  composite_momentum_score?: number | null;
  timeframes_available?: number | null;
  annualized_volatility: number | null;
  max_drawdown: number | null;
  price_performance: PricePerformance[];
}

export interface AnalyzeMomentumInput {
  symbols: string[];
  quote_currency?: string;
}

export interface MomentumRow {
  symbol: string;
  cmc_id: number | null;
  percent_change_1h: number | null;
  percent_change_24h: number | null;
  percent_change_7d: number | null;
  percent_change_30d: number | null;
  percent_change_60d: number | null;
  percent_change_90d: number | null;
  rs_vs_btc_24h: number | null;
  rs_vs_btc_7d: number | null;
  rs_vs_btc_30d: number | null;
  composite_momentum_score: number | null;
  timeframes_available?: number | null;
  acceleration_7d_vs_30d: number | null;
}

export interface AnalyzeMomentumData {
  quote_currency: string;
  assets: MomentumRow[];
}

export interface DetectAnomaliesInput {
  quote_currency?: string;
  universe_size?: number;
}

export interface AnomalyHit {
  symbol: string;
  cmc_id: number | null;
  metric: string;
  value: number | null;
  z_score: number | null;
  modified_z_score: number | null;
  direction?: AnomalyDirection | null;
}

export interface BtcDivergence {
  symbol: string;
  cmc_id: number | null;
  asset_change_24h_pct: number | null;
  btc_change_24h_pct: number | null;
  divergence_pct: number | null;
}

export interface DetectAnomaliesData {
  quote_currency: string;
  volume_mcap_outliers: AnomalyHit[];
  price_change_outliers: AnomalyHit[];
  btc_divergences: BtcDivergence[];
}

export interface MarketRegimeData {
  regime: RegimeLabel | null;
  total_mcap_change_24h_pct: number | null;
  btc_dominance_change_24h: number | null;
  top50_breadth_positive_pct: number | null;
  fear_greed_value: number | null;
  btc_outperforming_median_alt: boolean | null;
  signal_conflict?: boolean;
  confidence?: RegimeConfidence | null;
  dominant_signals?: string[];
  conflicting_signals?: string[];
  rationale: string[];
}

export interface SectorRotationInput {
  quote_currency?: string;
  sectors?: SectorSlug[] | null;
}

export interface SectorSnapshot {
  sector_slug: SectorSlug;
  display_name: string;
  constituent_count: number;
  median_change_24h_pct: number | null;
  median_change_7d_pct: number | null;
  excess_change_24h_vs_market_pct?: number | null;
  excess_change_7d_vs_market_pct?: number | null;
  cap_weighted_change_24h_pct: number | null;
  cap_weighted_change_7d_pct: number | null;
  breadth_positive_24h_pct: number | null;
  total_volume_24h: number | null;
  sector_volume_share_pct: number | null;
  rotation_signal: RotationSignal | null;
  taxonomy_source?: TaxonomySource | null;
  sample_sufficient?: boolean | null;
}

export interface SectorRotationData {
  quote_currency: string;
  sectors: SectorSnapshot[];
  unique_constituent_count?: number | null;
  overlapping_asset_count?: number | null;
}

export interface HistoricalPerformanceData {
  symbol: string;
  cmc_id: number | null;
  quote_currency: string;
  overlap_days: number | null;
  simple_return: number | null;
  log_return: number | null;
  annualized_volatility: number | null;
  max_drawdown: number | null;
  beta_vs_btc: number | null;
  correlation_vs_btc: number | null;
}

export interface DerivativePairObservation {
  market_id: number | null;
  exchange_id: number | null;
  exchange_name: string | null;
  exchange_slug: string | null;
  market_pair_symbol: string | null;
  category: string | null;
  quote_currency: string | null;
  price: number | null;
  volume_24h: number | null;
  open_interest: number | null;
  funding_rate: number | null;
  index_price: number | null;
  index_basis: number | null;
  outlier_detected: boolean | null;
  exclusions: string[];
  last_updated: string | null;
}

export interface DerivativesAnalysisData {
  symbol: string;
  cmc_id: number | null;
  quote_currency: string;
  mode: "derivatives" | "spot_stress_proxy";
  funding_rate: number | null;
  open_interest: number | null;
  liquidations_24h: number | null;
  market_pair_count: number | null;
  sampled_pair_count?: number | null;
  open_interest_pairs_included?: number | null;
  outlier_pairs_excluded?: number | null;
  market_pairs?: DerivativePairObservation[];
  spot_volume_24h: number | null;
  annualized_volatility: number | null;
}

export interface EvidenceRecord {
  evidence_id: string;
  tool_name: string;
  asset_cmc_ids?: number[];
  endpoints_called?: string[];
  data_mode: DataMode | string;
  freshness: Freshness | string;
  credit_cost: number;
  engine_version: string;
  methodology?: Partial<MethodologyMeta> & Record<string, unknown>;
  limitations?: string[];
  raw_excerpt?: Record<string, unknown>;
  created_at: string;
}

export interface EvidenceListResponse {
  records: EvidenceRecord[];
}

export interface TelemetrySummary {
  calls_by_surface: {
    mcp: number;
    rest: number;
    playground: number;
  };
  cache_hit_rate_pct: number | null;
  total_cmc_credits: number;
  average_latency_ms: number | null;
  active_data_mode: DataMode | null;
}

export interface HealthResponse {
  status: string;
  engine_version: string;
}

export type ToolName =
  | "get_market_overview"
  | "analyze_market_regime"
  | "scan_market_movers"
  | "compare_assets"
  | "analyze_asset"
  | "analyze_momentum"
  | "detect_market_anomalies"
  | "analyze_sector_rotation"
  | "get_historical_performance"
  | "analyze_derivatives";

export type ApiResult<T> =
  | {
      ok: true;
      status: number;
      data: T;
      latencyMs: number;
    }
  | {
      ok: false;
      status: number;
      message: string;
      retryAfterSeconds?: number;
      latencyMs: number;
    };
