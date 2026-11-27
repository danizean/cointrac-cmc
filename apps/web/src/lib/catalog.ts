import type { SectorSlug, ToolName } from "./types";

export interface ToolCatalogEntry {
  name: ToolName;
  label: string;
  method: "GET" | "POST";
  restPath: string;
  summary: string;
  routingNote: string;
}

export interface ResourceCatalogEntry {
  uri: string;
  description: string;
  backedBy: string;
}

export interface PromptCatalogEntry {
  name: string;
  args: string[];
  description: string;
  workflow: string;
}

export interface SectorMeta {
  slug: SectorSlug;
  label: string;
  highlighted?: boolean;
}

export const SECTOR_OPTIONS: SectorMeta[] = [
  { slug: "defi", label: "DeFi" },
  { slug: "ai-big-data", label: "AI & Big Data" },
  { slug: "layer-1", label: "Layer 1" },
  { slug: "layer-2", label: "Layer 2" },
  { slug: "gaming", label: "Gaming" },
  { slug: "rwa", label: "RWA", highlighted: true },
  { slug: "memes", label: "Memecoins" },
];

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: "get_market_overview",
    label: "Market Overview",
    method: "GET",
    restPath: "/v1/intelligence/market-overview",
    summary: "Total market cap, BTC/ETH dominance, Fear & Greed, Top-50 breadth, and spot leaders.",
    routingNote: "Use for macro snapshots. Use analyze_market_regime when a regime label is needed.",
  },
  {
    name: "analyze_market_regime",
    label: "Market Regime",
    method: "GET",
    restPath: "/v1/intelligence/market-regime",
    summary: "Deterministic 4-signal classifier returning regime label and exact numeric rationale.",
    routingNote: "Classifies RISK_ON_ALTSEASON, BTC_LED_EXPANSION, RISK_OFF_STRESS, or RANGE_CONSOLIDATION.",
  },
  {
    name: "scan_market_movers",
    label: "Scan Market Movers",
    method: "POST",
    restPath: "/v1/intelligence/scan-movers",
    summary: "Anti-chase momentum screener with market cap, liquidity, RS vs BTC, and max 24h gain caps.",
    routingNote: "Use for rule-based screening. Use detect_market_anomalies for statistical outliers.",
  },
  {
    name: "compare_assets",
    label: "Compare Assets",
    method: "POST",
    restPath: "/v1/intelligence/compare-assets",
    summary: "Side-by-side comparison of 2–8 assets across liquidity, FDV overhang, momentum, RS vs BTC, and vol.",
    routingNote: "Resolves tickers canonically to numeric CMC IDs before fetching quotes and info.",
  },
  {
    name: "analyze_asset",
    label: "Analyze Asset",
    method: "GET",
    restPath: "/v1/intelligence/assets/{symbol}",
    summary: "Single-asset fundamentals, supply inflation, tags, relative strength vs BTC, and performance.",
    routingNote: "Returns PARTIAL with null risk/performance metrics on Basic/Startup keys (OHLCV and price-performance require a higher CMC plan via BYOK).",
  },
  {
    name: "analyze_momentum",
    label: "Analyze Momentum",
    method: "POST",
    restPath: "/v1/intelligence/momentum",
    summary: "Multi-timeframe momentum decomposition (1h to 90d), RS vs BTC, and 7d vs 30d acceleration.",
    routingNote: "Uses the same deterministic sigmoid composite_momentum_score across scan_market_movers and compare_assets, reporting timeframes_available.",
  },
  {
    name: "detect_market_anomalies",
    label: "Detect Anomalies",
    method: "POST",
    restPath: "/v1/intelligence/anomalies",
    summary: "Standard Z-score and robust Modified Z-score (MAD) outliers plus strong BTC divergences.",
    routingNote: "Scans top 10–200 listings for volume-to-mcap spikes and opposing 24h moves vs BTC.",
  },
  {
    name: "analyze_sector_rotation",
    label: "Sector Rotation",
    method: "POST",
    restPath: "/v1/intelligence/sector-rotation",
    summary: "Median and cap-weighted performance, breadth, volume share, and rotation signals across 7 sectors.",
    routingNote: "Enforces a minimum 5-constituent sample guard (marking thin sectors INSUFFICIENT_DATA) and discloses multi-tag overlap.",
  },
  {
    name: "get_historical_performance",
    label: "Historical Performance",
    method: "GET",
    restPath: "/v1/intelligence/assets/{symbol}/historical",
    summary: "Daily aligned return statistics, sqrt(365) annualized volatility, max drawdown, beta, and correlation vs BTC.",
    routingNote: "Returns TIER_RESTRICTED with data_mode UNAVAILABLE when /v2/cryptocurrency/ohlcv/historical is unavailable on Basic/Startup tiers.",
  },
  {
    name: "analyze_derivatives",
    label: "Derivatives & Stress",
    method: "GET",
    restPath: "/v1/intelligence/assets/{symbol}/derivatives",
    summary: "CMC v5 derivatives market pairs (per-pair funding, open interest, outlier flags) or transparent spot-stress proxy.",
    routingNote: "Returns PARTIAL with per-pair observations and sampled non-outlier USD OI on v5 derivatives, or mode spot_stress_proxy when derivatives are unavailable.",
  },
];

export const RESOURCE_CATALOG: ResourceCatalogEntry[] = [
  {
    uri: "cointrac://market/overview",
    description: "Current macro snapshot envelope with dominance, breadth, and Fear & Greed.",
    backedBy: "get_market_overview",
  },
  {
    uri: "cointrac://market/trending",
    description: "Top 10 screened movers capped at <= 25% 24h gain (anti-chase filter).",
    backedBy: "scan_market_movers",
  },
  {
    uri: "cointrac://market/sectors",
    description: "Live sector rotation matrix across all 7 canonical crypto sectors including RWA.",
    backedBy: "analyze_sector_rotation",
  },
  {
    uri: "cointrac://assets/{symbol}/profile",
    description: "Canonical asset profile resolved to numeric cmc_id with supply and performance.",
    backedBy: "analyze_asset",
  },
  {
    uri: "cointrac://evidence/{evidence_id}",
    description: "Persisted audit provenance record for any prior tool invocation.",
    backedBy: "evidence_records",
  },
  {
    uri: "cointrac://hidden-gems/candidates/{candidate_id}",
    description:
      "Hidden Gem candidate detail with factor contributions, hard-gate outcomes, and audit provenance.",
    backedBy: "get_hidden_gem_detail",
  },
];

export const PROMPT_CATALOG: PromptCatalogEntry[] = [
  {
    name: "daily-market-briefing",
    args: [],
    description: "Structured macro briefing citing every evidence_id and UTC timestamp.",
    workflow: "get_market_overview -> analyze_market_regime -> analyze_sector_rotation",
  },
  {
    name: "asset-due-diligence",
    args: ["symbol", "peers"],
    description: "Single-asset deep dive against named peers highlighting liquidity and FDV overhang.",
    workflow: "analyze_asset -> compare_assets -> get_historical_performance",
  },
  {
    name: "market-risk-review",
    args: ["symbols"],
    description: "Risk-first evaluation flagging regime stress, anomalies, and derivatives proxy caveats.",
    workflow: "analyze_market_regime -> detect_market_anomalies -> analyze_derivatives",
  },
];

export interface PlaygroundPreset {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  primaryTool: ToolName;
  pairedTool?: ToolName;
  defaultParams: Record<string, unknown>;
}

export const PLAYGROUND_PRESETS: PlaygroundPreset[] = [
  {
    id: "daily-briefing",
    title: "Daily Market Briefing",
    subtitle: "Macro snapshot paired with deterministic 4-signal regime classification.",
    badge: "2 tools",
    primaryTool: "get_market_overview",
    pairedTool: "analyze_market_regime",
    defaultParams: {
      quote_currency: "USD",
    },
  },
  {
    id: "anti-chase",
    title: "Anti-Chase Momentum Discovery",
    subtitle: "Liquid mid/large-caps outperforming BTC while capping parabolic 24h spikes.",
    badge: "Screener",
    primaryTool: "scan_market_movers",
    defaultParams: {
      quote_currency: "USD",
      min_market_cap_usd: 250000000,
      min_volume_24h_usd: 15000000,
      max_24h_gain_pct: 18,
      rank_by: "composite_momentum_score",
      limit: 15,
      universe_size: 150,
    },
  },
  {
    id: "compare-l1",
    title: "Deep Research: SOL vs AVAX vs NEAR",
    subtitle:
      "Side-by-side liquidity ratio, FDV overhang, RS vs BTC, and 365d risk metrics (when OHLCV is enabled).",
    badge: "Comparison",
    primaryTool: "compare_assets",
    defaultParams: {
      symbols: ["SOL", "AVAX", "NEAR"],
      quote_currency: "USD",
    },
  },
  {
    id: "sector-rwa",
    title: "Sector Rotation & RWA Check",
    subtitle: "Median vs cap-weighted performance across DeFi, AI, L1, L2, Gaming, RWA, and Memes.",
    badge: "RWA Focus",
    primaryTool: "analyze_sector_rotation",
    defaultParams: {
      quote_currency: "USD",
      sectors: ["defi", "ai-big-data", "layer-1", "layer-2", "gaming", "rwa", "memes"],
    },
  },
];

export function publicMcpUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MCP_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return "https://mcp.cointrac.xyz/mcp";
}

export function publicOpenApiDocsUrl(): string {
  const mcpUrl = publicMcpUrl();
  try {
    const parsed = new URL(mcpUrl);
    if (parsed.hostname === "mcp.cointrac.xyz") return "https://api.cointrac.xyz/docs";
    return `${parsed.origin}/docs`;
  } catch {
    return "https://api.cointrac.xyz/docs";
  }
}
