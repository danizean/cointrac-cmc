import type {
  AnalyzeAssetData,
  AnalyzeMomentumData,
  CompareAssetsData,
  DerivativesAnalysisData,
  DetectAnomaliesData,
  EvidenceEnvelope,
  HistoricalPerformanceData,
  MarketOverviewData,
  MarketRegimeData,
  ScanMoversData,
  SectorRotationData,
  ToolName,
} from "./types";

export interface PlaygroundToolGroup {
  id: "macro" | "screen" | "risk";
  labelEn: string;
  labelId: string;
  tools: ToolName[];
}

export const PLAYGROUND_TOOL_GROUPS: PlaygroundToolGroup[] = [
  {
    id: "macro",
    labelEn: "Macro & Sectors",
    labelId: "Makro & Sektor",
    tools: [
      "get_market_overview",
      "analyze_market_regime",
      "analyze_sector_rotation",
    ],
  },
  {
    id: "screen",
    labelEn: "Screening & Assets",
    labelId: "Screening & Aset",
    tools: [
      "scan_market_movers",
      "compare_assets",
      "analyze_asset",
      "analyze_momentum",
    ],
  },
  {
    id: "risk",
    labelEn: "Risk & Historical",
    labelId: "Risiko & Historis",
    tools: [
      "detect_market_anomalies",
      "analyze_derivatives",
      "get_historical_performance",
    ],
  },
];

const SAMPLE_TIMESTAMP = "2026-04-01T12:00:00Z";

function sampleDisclaimer(locale: "en" | "id"): string {
  return locale === "id"
    ? "Contoh skema ilustratif (payload sampel, bukan harga pasar live). Masuk dan klik Run untuk mengambil data CoinMarketCap terbaru."
    : "Illustrative schema example (sample payload, not live market prices). Sign in and click Run to fetch live CoinMarketCap data.";
}

export function getSampleEnvelopeForTool(
  tool: ToolName,
  locale: "en" | "id" = "en",
): EvidenceEnvelope {
  const disclaimer = sampleDisclaimer(locale);
  const engineVersion = "1.0.0-sample";

  switch (tool) {
    case "get_market_overview": {
      const data: MarketOverviewData = {
        quote_currency: "USD",
        total_market_cap: 2_680_000_000_000,
        total_volume_24h: 94_500_000_000,
        total_market_cap_change_24h_pct: 1.84,
        btc_dominance: 56.4,
        eth_dominance: 11.8,
        btc_dominance_change_24h: -0.32,
        fear_greed_value: 61,
        fear_greed_classification: "Greed",
        top50_breadth_positive_pct: 72.0,
        btc: {
          cmc_id: 1,
          symbol: "BTC",
          name: "Bitcoin",
          price: 84250,
          market_cap: 1_670_000_000_000,
          volume_24h: 31_200_000_000,
          percent_change_24h: 1.45,
        },
        eth: {
          cmc_id: 1027,
          symbol: "ETH",
          name: "Ethereum",
          price: 2140,
          market_cap: 258_000_000_000,
          volume_24h: 14_900_000_000,
          percent_change_24h: 2.38,
        },
        sol: {
          cmc_id: 5426,
          symbol: "SOL",
          name: "Solana",
          price: 148.6,
          market_cap: 76_400_000_000,
          volume_24h: 3_850_000_000,
          percent_change_24h: 4.12,
        },
        top_gainers: [
          {
            cmc_id: 5426,
            symbol: "SOL",
            name: "Solana",
            price: 148.6,
            market_cap: 76_400_000_000,
            volume_24h: 3_850_000_000,
            percent_change_24h: 4.12,
          },
          {
            cmc_id: 1975,
            symbol: "LINK",
            name: "Chainlink",
            price: 16.4,
            market_cap: 10_500_000_000,
            volume_24h: 495_000_000,
            percent_change_24h: 3.74,
          },
        ],
        top_losers: [
          {
            cmc_id: 3794,
            symbol: "ATOM",
            name: "Cosmos",
            price: 4.62,
            market_cap: 1_810_000_000,
            volume_24h: 112_000_000,
            percent_change_24h: -2.18,
          },
        ],
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "OK",
        summary:
          locale === "id"
            ? "[Sampel] Kapitalisasi pasar global $2.68T (+1.84% 24j), dominasi BTC 56.4%, keluasan Top-50 positif 72.0%, dan Fear & Greed 61."
            : "[Sample] Global market cap stands at $2.68T (+1.84% 24h) with 56.4% BTC dominance, 72.0% Top-50 positive breadth, and Fear & Greed at 61.",
        data,
        methodology: {
          metrics: [
            "total_market_cap",
            "btc_dominance",
            "fear_greed_value",
            "top50_breadth_positive_pct",
          ],
          observation_window: "24h cross-sectional snapshot",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_market_overview",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: {
            global_metrics: SAMPLE_TIMESTAMP,
            fear_greed: SAMPLE_TIMESTAMP,
            listings_latest: SAMPLE_TIMESTAMP,
          },
          cmc_endpoints_called: [
            "/v1/global-metrics/quotes/latest",
            "/v3/fear-and-greed/latest",
            "/v1/cryptocurrency/listings/latest",
          ],
          cmc_credit_cost: 3,
          cache_hit: true,
        },
        limitations: [disclaimer],
      };
    }

    case "analyze_market_regime": {
      const data: MarketRegimeData = {
        regime: "RISK_ON_ALTSEASON",
        total_mcap_change_24h_pct: 1.84,
        btc_dominance_change_24h: -0.32,
        top50_breadth_positive_pct: 72.0,
        fear_greed_value: 61,
        btc_outperforming_median_alt: false,
        signal_conflict: false,
        confidence: "HIGH",
        dominant_signals: [
          "total_mcap_change_24h_pct > 0 (+1.84%)",
          "btc_dominance_change_24h < 0 (-0.32 pp)",
          "top50_breadth_positive_pct >= 60% (72.0%)",
          "median_alt_24h > btc_24h (+2.65% vs +1.45%)",
        ],
        conflicting_signals: [],
        rationale: [
          "Total market cap expanded +1.84% over 24h while BTC dominance eased -0.32 pp.",
          "Top-50 breadth is broad-based at 72.0% positive with median altcoin outperforming BTC.",
          "Sentiment sits in constructive Greed territory (61/100) without extreme exhaustion.",
        ],
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "OK",
        summary:
          locale === "id"
            ? "[Sampel] Rezim diklasifikasikan RISK_ON_ALTSEASON (keyakinan HIGH) dari 4 sinyal kuantitatif deterministik."
            : "[Sample] Market regime classified as RISK_ON_ALTSEASON (HIGH confidence) across all 4 deterministic macro breadth signals.",
        data,
        methodology: {
          metrics: [
            "total_mcap_change_24h_pct",
            "btc_dominance_change_24h",
            "top50_breadth_positive_pct",
            "btc_vs_median_alt_spread",
          ],
          observation_window: "24h deterministic 4-signal state classifier",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_market_regime",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: {
            global_metrics: SAMPLE_TIMESTAMP,
            listings_latest: SAMPLE_TIMESTAMP,
            fear_greed: SAMPLE_TIMESTAMP,
          },
          cmc_endpoints_called: [
            "/v1/global-metrics/quotes/latest",
            "/v1/cryptocurrency/listings/latest",
            "/v3/fear-and-greed/latest",
          ],
          cmc_credit_cost: 3,
          cache_hit: true,
        },
        limitations: [disclaimer],
      };
    }

    case "scan_market_movers": {
      const data: ScanMoversData = {
        quote_currency: "USD",
        rank_by: "composite_momentum_score",
        movers: [
          {
            cmc_id: 5426,
            symbol: "SOL",
            name: "Solana",
            market_cap: 76_400_000_000,
            volume_24h: 3_850_000_000,
            volume_to_mcap: 0.0504,
            percent_change_24h: 4.12,
            percent_change_7d: 11.8,
            percent_change_30d: 19.4,
            rs_vs_btc_7d: 7.2,
            composite_momentum_score: 76.4,
            timeframes_available: 6,
            multi_horizon_risk: "RECENT_MOMENTUM",
          },
          {
            cmc_id: 1975,
            symbol: "LINK",
            name: "Chainlink",
            market_cap: 10_500_000_000,
            volume_24h: 495_000_000,
            volume_to_mcap: 0.0471,
            percent_change_24h: 3.74,
            percent_change_7d: 9.25,
            percent_change_30d: 15.1,
            rs_vs_btc_7d: 4.65,
            composite_momentum_score: 71.8,
            timeframes_available: 6,
            multi_horizon_risk: "RECENT_MOMENTUM",
          },
          {
            cmc_id: 6535,
            symbol: "NEAR",
            name: "NEAR Protocol",
            market_cap: 4_150_000_000,
            volume_24h: 288_000_000,
            volume_to_mcap: 0.0694,
            percent_change_24h: 5.05,
            percent_change_7d: 14.3,
            percent_change_30d: 26.8,
            rs_vs_btc_7d: 9.7,
            composite_momentum_score: 79.1,
            timeframes_available: 6,
            multi_horizon_risk: "EXTENDED_RALLY",
          },
        ],
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "OK",
        summary:
          locale === "id"
            ? "[Sampel] 3 kandidat lolos filter anti-chase (MCap >= $250M, Vol >= $15M, kenaikan 24j <= 18%)."
            : "[Sample] Returned 3 liquid movers passing anti-chase caps (MCap >= $250M, Vol >= $15M, 24h gain <= 18%).",
        data,
        methodology: {
          metrics: [
            "composite_momentum_score",
            "rs_vs_btc_7d",
            "volume_to_mcap",
            "multi_horizon_risk",
          ],
          observation_window: "Multi-horizon quotes (1h to 90d), universe=150",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_scan_movers",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: { listings_latest: SAMPLE_TIMESTAMP },
          cmc_endpoints_called: ["/v1/cryptocurrency/listings/latest"],
          cmc_credit_cost: 1,
          cache_hit: true,
        },
        limitations: [disclaimer],
      };
    }

    case "compare_assets": {
      const data: CompareAssetsData = {
        quote_currency: "USD",
        assets: [
          {
            cmc_id: 5426,
            symbol: "SOL",
            name: "Solana",
            price: 148.6,
            market_cap: 76_400_000_000,
            volume_24h: 3_850_000_000,
            volume_to_mcap: 0.0504,
            fdv_to_mcap_ratio: 1.17,
            circulating_supply_pct: 85.4,
            percent_change_24h: 4.12,
            percent_change_7d: 11.8,
            percent_change_30d: 19.4,
            percent_change_60d: 8.2,
            rs_vs_btc_24h: 2.67,
            rs_vs_btc_7d: 7.2,
            rs_vs_btc_30d: 11.9,
            composite_momentum_score: 76.4,
            timeframes_available: 6,
            annualized_volatility: null,
            max_drawdown: null,
          },
          {
            cmc_id: 5805,
            symbol: "AVAX",
            name: "Avalanche",
            price: 22.8,
            market_cap: 9_450_000_000,
            volume_24h: 390_000_000,
            volume_to_mcap: 0.0413,
            fdv_to_mcap_ratio: 1.73,
            circulating_supply_pct: 57.8,
            percent_change_24h: 2.45,
            percent_change_7d: 6.4,
            percent_change_30d: 4.9,
            percent_change_60d: -3.1,
            rs_vs_btc_24h: 1.0,
            rs_vs_btc_7d: 1.8,
            rs_vs_btc_30d: -2.6,
            composite_momentum_score: 58.2,
            timeframes_available: 6,
            annualized_volatility: null,
            max_drawdown: null,
          },
          {
            cmc_id: 6535,
            symbol: "NEAR",
            name: "NEAR Protocol",
            price: 3.45,
            market_cap: 4_150_000_000,
            volume_24h: 288_000_000,
            volume_to_mcap: 0.0694,
            fdv_to_mcap_ratio: 1.04,
            circulating_supply_pct: 96.1,
            percent_change_24h: 5.05,
            percent_change_7d: 14.3,
            percent_change_30d: 26.8,
            percent_change_60d: 14.6,
            rs_vs_btc_24h: 3.6,
            rs_vs_btc_7d: 9.7,
            rs_vs_btc_30d: 19.3,
            composite_momentum_score: 79.1,
            timeframes_available: 6,
            annualized_volatility: null,
            max_drawdown: null,
          },
        ],
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "PARTIAL",
        summary:
          locale === "id"
            ? "[Sampel] Perbandingan 3 aset (SOL, AVAX, NEAR) menggunakan resolusi CMC ID kanonik; metrik OHLCV tetap null pada tier Basic."
            : "[Sample] Compared 3 canonical assets (SOL, AVAX, NEAR) across liquidity, FDV overhang, and RS vs BTC; OHLCV risk fields remain null without higher CMC tier.",
        data,
        methodology: {
          metrics: [
            "volume_to_mcap",
            "fdv_to_mcap_ratio",
            "rs_vs_btc_7d",
            "composite_momentum_score",
          ],
          observation_window: "Multi-horizon spot comparison (24h/7d/30d)",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_compare_assets",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: {
            quotes_latest: SAMPLE_TIMESTAMP,
            asset_info: SAMPLE_TIMESTAMP,
          },
          cmc_endpoints_called: [
            "/v2/cryptocurrency/quotes/latest",
            "/v2/cryptocurrency/info",
          ],
          cmc_credit_cost: 2,
          cache_hit: true,
        },
        limitations: [
          disclaimer,
          "annualized_volatility and max_drawdown stay null when historical OHLCV is unavailable on Basic/Startup keys.",
        ],
      };
    }

    case "analyze_asset": {
      const data: AnalyzeAssetData = {
        symbol: "SOL",
        cmc_id: 5426,
        name: "Solana",
        quote_currency: "USD",
        price: 148.6,
        market_cap: 76_400_000_000,
        volume_24h: 3_850_000_000,
        volume_to_mcap: 0.0504,
        fdv_to_mcap_ratio: 1.17,
        circulating_supply: 514_130_000,
        total_supply: 601_540_000,
        max_supply: null,
        circulating_supply_pct: 85.4,
        tags: ["layer-1", "smart-contracts", "proof-of-stake"],
        percent_change_24h: 4.12,
        percent_change_7d: 11.8,
        percent_change_30d: 19.4,
        percent_change_60d: 8.2,
        rs_vs_btc_24h: 2.67,
        rs_vs_btc_7d: 7.2,
        rs_vs_btc_30d: 11.9,
        composite_momentum_score: 76.4,
        timeframes_available: 6,
        annualized_volatility: null,
        max_drawdown: null,
        price_performance: [],
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "PARTIAL",
        summary:
          locale === "id"
            ? "[Sampel] Profil fundamental SOL (cmc_id: 5426): likuiditas 5.04% Vol/MCap, rasio FDV 1.17x; max_supply & OHLCV jujur null."
            : "[Sample] Solana (cmc_id: 5426) fundamentals: 5.04% Vol/MCap turnover, 1.17x FDV/MCap overhang, and +7.2% 7d RS vs BTC.",
        data,
        methodology: {
          metrics: [
            "fdv_to_mcap_ratio",
            "circulating_supply_pct",
            "rs_vs_btc_7d",
            "composite_momentum_score",
          ],
          observation_window: "Canonical spot profile + BTC benchmark quote",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_analyze_asset",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: {
            quotes_latest: SAMPLE_TIMESTAMP,
            asset_info: SAMPLE_TIMESTAMP,
          },
          cmc_endpoints_called: [
            "/v2/cryptocurrency/quotes/latest",
            "/v2/cryptocurrency/info",
          ],
          cmc_credit_cost: 2,
          cache_hit: true,
        },
        limitations: [
          disclaimer,
          "max_supply is uncapped (null). OHLCV volatility, max drawdown, and price-performance stats require a BYOK higher-tier key.",
        ],
      };
    }

    case "analyze_momentum": {
      const data: AnalyzeMomentumData = {
        quote_currency: "USD",
        assets: [
          {
            symbol: "SOL",
            cmc_id: 5426,
            percent_change_1h: 0.42,
            percent_change_24h: 4.12,
            percent_change_7d: 11.8,
            percent_change_30d: 19.4,
            percent_change_60d: 8.2,
            percent_change_90d: -4.6,
            rs_vs_btc_24h: 2.67,
            rs_vs_btc_7d: 7.2,
            rs_vs_btc_30d: 11.9,
            composite_momentum_score: 76.4,
            timeframes_available: 6,
            acceleration_7d_vs_30d: 5.9,
          },
          {
            symbol: "AVAX",
            cmc_id: 5805,
            percent_change_1h: 0.18,
            percent_change_24h: 2.45,
            percent_change_7d: 6.4,
            percent_change_30d: 4.9,
            percent_change_60d: -3.1,
            percent_change_90d: -9.8,
            rs_vs_btc_24h: 1.0,
            rs_vs_btc_7d: 1.8,
            rs_vs_btc_30d: -2.6,
            composite_momentum_score: 58.2,
            timeframes_available: 6,
            acceleration_7d_vs_30d: 4.77,
          },
          {
            symbol: "NEAR",
            cmc_id: 6535,
            percent_change_1h: 0.61,
            percent_change_24h: 5.05,
            percent_change_7d: 14.3,
            percent_change_30d: 26.8,
            percent_change_60d: 14.6,
            percent_change_90d: 3.1,
            rs_vs_btc_24h: 3.6,
            rs_vs_btc_7d: 9.7,
            rs_vs_btc_30d: 19.3,
            composite_momentum_score: 79.1,
            timeframes_available: 6,
            acceleration_7d_vs_30d: 5.37,
          },
        ],
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "OK",
        summary:
          locale === "id"
            ? "[Sampel] Dekomposisi momentum 1j–90h untuk SOL, AVAX, NEAR; seluruh skor memakai fungsi sigmoid deterministik yang sama."
            : "[Sample] Decomposed 1h–90d momentum and 7d-vs-30d acceleration across SOL, AVAX, and NEAR.",
        data,
        methodology: {
          metrics: [
            "composite_momentum_score",
            "acceleration_7d_vs_30d",
            "rs_vs_btc_7d",
            "timeframes_available",
          ],
          observation_window: "6 timeframes (1h, 24h, 7d, 30d, 60d, 90d)",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_analyze_momentum",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: { quotes_latest: SAMPLE_TIMESTAMP },
          cmc_endpoints_called: ["/v2/cryptocurrency/quotes/latest"],
          cmc_credit_cost: 1,
          cache_hit: true,
        },
        limitations: [disclaimer],
      };
    }

    case "detect_market_anomalies": {
      const data: DetectAnomaliesData = {
        quote_currency: "USD",
        volume_mcap_outliers: [
          {
            symbol: "SUI",
            cmc_id: 20947,
            metric: "volume_to_mcap",
            value: 0.284,
            z_score: 3.42,
            modified_z_score: 4.18,
            direction: "HIGH_VOLUME_TO_MCAP",
          },
          {
            symbol: "APT",
            cmc_id: 21794,
            metric: "volume_to_mcap",
            value: 0.196,
            z_score: 2.31,
            modified_z_score: 2.94,
            direction: "HIGH_VOLUME_TO_MCAP",
          },
        ],
        price_change_outliers: [
          {
            symbol: "TAO",
            cmc_id: 22974,
            metric: "percent_change_24h",
            value: 16.8,
            z_score: 3.15,
            modified_z_score: 3.72,
            direction: null,
          },
        ],
        btc_divergences: [
          {
            symbol: "TON",
            cmc_id: 11419,
            asset_change_24h_pct: -6.4,
            btc_change_24h_pct: 1.45,
            divergence_pct: -7.85,
          },
        ],
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "OK",
        summary:
          locale === "id"
            ? "[Sampel] Terdeteksi 2 outlier turnover Vol/MCap, 1 outlier harga 24j (MAD Modified Z-score), dan 1 divergensi tajam terhadap BTC."
            : "[Sample] Flagged 2 high-turnover Vol/MCap outliers, 1 price Z-score outlier, and 1 counter-trend BTC divergence across Top-150.",
        data,
        methodology: {
          metrics: [
            "z_score",
            "modified_z_score",
            "btc_divergence_pct",
          ],
          observation_window: "Top-150 cross-sectional listings (24h window)",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_anomalies",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: { listings_latest: SAMPLE_TIMESTAMP },
          cmc_endpoints_called: ["/v1/cryptocurrency/listings/latest"],
          cmc_credit_cost: 1,
          cache_hit: true,
        },
        limitations: [disclaimer],
      };
    }

    case "analyze_sector_rotation": {
      const data: SectorRotationData = {
        quote_currency: "USD",
        unique_constituent_count: 142,
        overlapping_asset_count: 18,
        sectors: [
          {
            sector_slug: "rwa",
            display_name: "RWA",
            constituent_count: 12,
            median_change_24h_pct: 4.85,
            median_change_7d_pct: 13.4,
            excess_change_24h_vs_market_pct: 3.01,
            excess_change_7d_vs_market_pct: 8.8,
            cap_weighted_change_24h_pct: 4.2,
            cap_weighted_change_7d_pct: 11.9,
            breadth_positive_24h_pct: 83.3,
            total_volume_24h: 1_940_000_000,
            sector_volume_share_pct: 6.4,
            rotation_signal: "LEADING",
            taxonomy_source: "cmc_category",
            sample_sufficient: true,
          },
          {
            sector_slug: "ai-big-data",
            display_name: "AI & Big Data",
            constituent_count: 24,
            median_change_24h_pct: 3.6,
            median_change_7d_pct: 9.8,
            excess_change_24h_vs_market_pct: 1.76,
            excess_change_7d_vs_market_pct: 5.2,
            cap_weighted_change_24h_pct: 4.1,
            cap_weighted_change_7d_pct: 10.6,
            breadth_positive_24h_pct: 75.0,
            total_volume_24h: 4_120_000_000,
            sector_volume_share_pct: 13.6,
            rotation_signal: "GAINING_MOMENTUM",
            taxonomy_source: "cmc_category",
            sample_sufficient: true,
          },
          {
            sector_slug: "layer-1",
            display_name: "Layer 1",
            constituent_count: 38,
            median_change_24h_pct: 2.15,
            median_change_7d_pct: 6.1,
            excess_change_24h_vs_market_pct: 0.31,
            excess_change_7d_vs_market_pct: 1.5,
            cap_weighted_change_24h_pct: 1.95,
            cap_weighted_change_7d_pct: 5.8,
            breadth_positive_24h_pct: 68.4,
            total_volume_24h: 14_500_000_000,
            sector_volume_share_pct: 47.9,
            rotation_signal: "NEUTRAL",
            taxonomy_source: "cmc_category",
            sample_sufficient: true,
          },
          {
            sector_slug: "defi",
            display_name: "DeFi",
            constituent_count: 29,
            median_change_24h_pct: 1.9,
            median_change_7d_pct: 4.2,
            excess_change_24h_vs_market_pct: 0.06,
            excess_change_7d_vs_market_pct: -0.4,
            cap_weighted_change_24h_pct: 2.05,
            cap_weighted_change_7d_pct: 4.9,
            breadth_positive_24h_pct: 62.1,
            total_volume_24h: 3_680_000_000,
            sector_volume_share_pct: 12.1,
            rotation_signal: "NEUTRAL",
            taxonomy_source: "cmc_category",
            sample_sufficient: true,
          },
          {
            sector_slug: "gaming",
            display_name: "Gaming",
            constituent_count: 14,
            median_change_24h_pct: -0.8,
            median_change_7d_pct: -2.9,
            excess_change_24h_vs_market_pct: -2.64,
            excess_change_7d_vs_market_pct: -7.5,
            cap_weighted_change_24h_pct: -1.1,
            cap_weighted_change_7d_pct: -3.4,
            breadth_positive_24h_pct: 35.7,
            total_volume_24h: 980_000_000,
            sector_volume_share_pct: 3.2,
            rotation_signal: "LAGGING",
            taxonomy_source: "cmc_category",
            sample_sufficient: true,
          },
        ],
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "OK",
        summary:
          locale === "id"
            ? "[Sampel] RWA memimpin (+4.85% median 24j, breadth 83.3%), disusul AI & Big Data; 18 aset multi-tag dilaporkan secara transparan."
            : "[Sample] RWA leads rotation (+4.85% 24h median, 83.3% breadth), followed by AI & Big Data; discloses 18 overlapping multi-tag assets.",
        data,
        methodology: {
          metrics: [
            "median_change_24h_pct",
            "cap_weighted_change_24h_pct",
            "breadth_positive_24h_pct",
            "sector_volume_share_pct",
          ],
          observation_window: "24h & 7d canonical category matrix (min n=5)",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_sector_rotation",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: { categories: SAMPLE_TIMESTAMP },
          cmc_endpoints_called: [
            "/v1/cryptocurrency/categories",
            "/v1/cryptocurrency/category",
          ],
          cmc_credit_cost: 7,
          cache_hit: true,
        },
        limitations: [disclaimer],
      };
    }

    case "get_historical_performance": {
      const data: HistoricalPerformanceData = {
        symbol: "SOL",
        cmc_id: 5426,
        quote_currency: "USD",
        overlap_days: null,
        simple_return: null,
        log_return: null,
        annualized_volatility: null,
        max_drawdown: null,
        beta_vs_btc: null,
        correlation_vs_btc: null,
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "TIER_RESTRICTED",
        summary:
          locale === "id"
            ? "[Sampel] Contoh jujur TIER_RESTRICTED: metrik historis OHLCV dibiarkan null (bukan 0) jika kunci CMC belum memiliki akses OHLCV."
            : "[Sample] Honest TIER_RESTRICTED illustration: OHLCV risk metrics remain null (never coerced to 0) when the CMC tier lacks historical OHLCV.",
        data,
        methodology: {
          metrics: [
            "simple_return",
            "log_return",
            "annualized_volatility_365d",
            "max_drawdown",
            "beta_vs_btc",
          ],
          observation_window: "30 daily OHLCV candles",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_historical_restricted",
          data_mode: "UNAVAILABLE",
          freshness: "STALE",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: {},
          cmc_endpoints_called: ["/v2/cryptocurrency/ohlcv/historical"],
          cmc_credit_cost: 0,
          cache_hit: false,
        },
        limitations: [
          disclaimer,
          "Simulated TIER_RESTRICTED response: supply a BYOK higher-tier CoinMarketCap API key in the drawer to unlock daily OHLCV sqrt(365) risk metrics.",
        ],
      };
    }

    case "analyze_derivatives": {
      const data: DerivativesAnalysisData = {
        symbol: "SOL",
        cmc_id: 5426,
        quote_currency: "USD",
        mode: "derivatives",
        funding_rate: 0.000112,
        open_interest: 1_920_000_000,
        liquidations_24h: null,
        market_pair_count: 18,
        sampled_pair_count: 5,
        open_interest_pairs_included: 4,
        outlier_pairs_excluded: 1,
        market_pairs: [
          {
            market_id: 901,
            exchange_id: 270,
            exchange_name: "Binance",
            exchange_slug: "binance",
            market_pair_symbol: "SOL/USDT",
            category: "perpetual",
            quote_currency: "USDT",
            price: 148.62,
            volume_24h: 1_420_000_000,
            open_interest: 860_000_000,
            funding_rate: 0.000108,
            index_price: 148.59,
            index_basis: 0.0002,
            outlier_detected: false,
            exclusions: [],
            last_updated: SAMPLE_TIMESTAMP,
          },
          {
            market_id: 902,
            exchange_id: 521,
            exchange_name: "Bybit",
            exchange_slug: "bybit",
            market_pair_symbol: "SOL/USDT",
            category: "perpetual",
            quote_currency: "USDT",
            price: 148.65,
            volume_24h: 910_000_000,
            open_interest: 640_000_000,
            funding_rate: 0.000116,
            index_price: 148.59,
            index_basis: 0.0004,
            outlier_detected: false,
            exclusions: [],
            last_updated: SAMPLE_TIMESTAMP,
          },
          {
            market_id: 903,
            exchange_id: 999,
            exchange_name: "ThinVenue",
            exchange_slug: "thinvenue",
            market_pair_symbol: "SOL/USD-PERP",
            category: "perpetual",
            quote_currency: "USD",
            price: 162.4,
            volume_24h: 185_000,
            open_interest: 42_000_000,
            funding_rate: 0.00089,
            index_price: 148.59,
            index_basis: 0.0929,
            outlier_detected: true,
            exclusions: ["index_basis_outlier"],
            last_updated: SAMPLE_TIMESTAMP,
          },
        ],
        spot_volume_24h: 3_850_000_000,
        annualized_volatility: null,
      };

      return {
        tool,
        engine_version: engineVersion,
        status: "PARTIAL",
        summary:
          locale === "id"
            ? "[Sampel] SOL perpetual: OI teragregasi $1.92B (4 pair bersih, 1 outlier dikecualikan), funding +0.0112%; liquidations_24h tetap null."
            : "[Sample] SOL derivatives: $1.92B sampled non-outlier OI across 4 clean pairs (1 outlier excluded), funding +0.0112%; liquidations_24h remains null.",
        data,
        methodology: {
          metrics: [
            "funding_rate",
            "open_interest",
            "index_basis",
            "outlier_pairs_excluded",
          ],
          observation_window: "Per-pair derivatives snapshot + outlier basis guard",
          annualization_basis: "365d",
        },
        evidence: {
          evidence_id: "ev_sample_schema_derivatives",
          data_mode: "CACHED",
          freshness: "FRESH",
          retrieved_at_utc: SAMPLE_TIMESTAMP,
          source_timestamps: { market_pairs: SAMPLE_TIMESTAMP },
          cmc_endpoints_called: [
            "/v2/cryptocurrency/quotes/latest",
            "/v2/cryptocurrency/market-pairs/latest",
          ],
          cmc_credit_cost: 2,
          cache_hit: true,
        },
        limitations: [
          disclaimer,
          "liquidations_24h is unavailable on CoinMarketCap market-pairs endpoints and stays null; 1 outlier pair was excluded via index_basis check.",
        ],
      };
    }
  }
}

export function getPresetSampleEnvelopes(
  primaryTool: ToolName,
  pairedTool?: ToolName,
  locale: "en" | "id" = "en",
): EvidenceEnvelope[] {
  const out: EvidenceEnvelope[] = [];
  if (pairedTool) {
    out.push(getSampleEnvelopeForTool(pairedTool, locale));
  }
  out.push(getSampleEnvelopeForTool(primaryTool, locale));
  return out;
}
