/**
 * Pure, unit-testable navigation, command-search, breadcrumb, and onboarding
 * state helpers for the CoinTrac R3 Workspace.
 */

import type { BreadcrumbItem } from "@/components/ui/primitives";
import type { Locale } from "./i18n";

export const SIDEBAR_COLLAPSED_KEY = "ct_sidebar_collapsed";

export function readSidebarCollapsed(read: (key: string) => string | null): boolean {
  try {
    return read(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export type WorkspaceNavId =
  | "overview"
  | "ai"
  | "market"
  | "keys"
  | "connections"
  | "usage"
  | "evidence"
  | "settings";

export type WorkspaceGroupId = "workspace" | "connect" | "observe";

export interface WorkspaceNavItem {
  id: WorkspaceNavId;
  group: WorkspaceGroupId;
  href: string;
  label: { en: string; id: string };
  description: { en: string; id: string };
}

export const WORKSPACE_GROUPS: ReadonlyArray<{
  id: WorkspaceGroupId;
  label: { en: string; id: string };
}> = [
  { id: "workspace", label: { en: "Workspace", id: "Ruang Kerja" } },
  { id: "connect", label: { en: "Connect & Access", id: "Koneksi & Akses" } },
  { id: "observe", label: { en: "Observe & Manage", id: "Pantau & Kelola" } },
];

export const WORKSPACE_NAV_ITEMS: ReadonlyArray<WorkspaceNavItem> = [
  {
    id: "overview",
    group: "workspace",
    href: "/app",
    label: { en: "Overview", id: "Ringkasan" },
    description: {
      en: "Workspace readiness, quickstart, and recent activity",
      id: "Kesiapan ruang kerja, panduan cepat, dan aktivitas terbaru",
    },
  },
  {
    id: "ai",
    group: "workspace",
    href: "/app/ai",
    label: { en: "CoinTrac AI", id: "CoinTrac AI" },
    description: {
      en: "Precision Muse Spark 1.3 market analyst with live tool calling & evidence",
      id: "Analis AI Muse Spark 1.3 presisi dengan tool calling langsung & bukti data",
    },
  },
  {
    id: "market",
    group: "workspace",
    href: "/app/market",
    label: { en: "Market Intelligence", id: "Intelijen Pasar" },
    description: {
      en: "Macro regime, assets, movers, anomalies, sectors, derivatives, and history",
      id: "Rezim makro, aset, penggerak, anomali, sektor, derivatif, dan historis",
    },
  },
  {
    id: "keys",
    group: "connect",
    href: "/app/keys",
    label: { en: "API Keys", id: "Kunci API" },
    description: {
      en: "Create and revoke personal access credentials",
      id: "Buat dan cabut kredensial akses pribadi",
    },
  },
  {
    id: "connections",
    group: "connect",
    href: "/app/connections",
    label: { en: "MCP Connections", id: "Koneksi MCP" },
    description: {
      en: "Connect AI agents via Local or Remote MCP",
      id: "Hubungkan AI agent melalui Local atau Remote MCP",
    },
  },
  {
    id: "usage",
    group: "observe",
    href: "/app/usage",
    label: { en: "Usage", id: "Penggunaan" },
    description: {
      en: "Tool quota, CoinMarketCap credits, and tier capabilities",
      id: "Kuota tool, kredit CoinMarketCap, dan kapabilitas paket",
    },
  },
  {
    id: "evidence",
    group: "observe",
    href: "/app/evidence",
    label: { en: "Evidence", id: "Bukti Data" },
    description: {
      en: "Data provenance, source endpoints, and timestamps",
      id: "Asal data, endpoint sumber, dan stempel waktu",
    },
  },
  {
    id: "settings",
    group: "observe",
    href: "/app/settings",
    label: { en: "Settings", id: "Pengaturan" },
    description: {
      en: "Account profile, tier info, and session",
      id: "Profil akun, info paket, dan sesi",
    },
  },
];

export interface MarketSubRoute {
  href: string;
  label: { en: string; id: string };
  keywords: string[];
}

export const MARKET_SUB_ROUTES: ReadonlyArray<MarketSubRoute> = [
  {
    href: "/app/market",
    label: { en: "Overview & Regime", id: "Pasar & Rezim" },
    keywords: ["market", "macro", "regime", "fear", "greed", "dominance"],
  },
  {
    href: "/app/assets",
    label: { en: "Assets & Compare", id: "Aset & Bandingkan" },
    keywords: ["asset", "btc", "eth", "sol", "compare", "momentum", "profile"],
  },
  {
    href: "/app/movers",
    label: { en: "Movers Screener", id: "Penyaring Penggerak" },
    keywords: ["movers", "screener", "anti-chase", "volume", "gain"],
  },
  {
    href: "/app/hidden-gems",
    label: { en: "Hidden Gems", id: "Hidden Gems" },
    keywords: ["hidden", "gems", "discovery", "early", "confirmed", "watchlist", "alpha"],
  },
  {
    href: "/app/anomalies",
    label: { en: "Anomalies", id: "Anomali" },
    keywords: ["anomalies", "outlier", "z-score", "divergence", "mad"],
  },
  {
    href: "/app/sectors",
    label: { en: "Sector Rotation", id: "Rotasi Sektor" },
    keywords: ["sector", "rotation", "defi", "rwa", "ai", "layer-1", "layer-2"],
  },
  {
    href: "/app/derivatives",
    label: { en: "Derivatives", id: "Derivatif" },
    keywords: ["derivatives", "funding", "open interest", "stress", "proxy"],
  },
  {
    href: "/app/historical",
    label: { en: "Historical", id: "Historis" },
    keywords: ["historical", "volatility", "drawdown", "beta", "correlation", "ohlcv"],
  },
];

const MARKET_ROUTE_SET = new Set(MARKET_SUB_ROUTES.map((item) => item.href));

export function isMarketIntelligencePath(pathname: string): boolean {
  return MARKET_SUB_ROUTES.some(
    (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
  );
}

export function isWorkspaceNavActive(item: WorkspaceNavItem, pathname: string): boolean {
  if (item.id === "overview") {
    return pathname === "/app";
  }
  if (item.id === "market") {
    return isMarketIntelligencePath(pathname);
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function breadcrumbsForWorkspacePath(pathname: string, locale: Locale): BreadcrumbItem[] {
  const rootLabel = locale === "id" ? "Ruang Kerja" : "Workspace";
  if (pathname === "/app") {
    return [{ label: rootLabel }, { label: locale === "id" ? "Ringkasan" : "Overview" }];
  }

  const marketMatch = MARKET_SUB_ROUTES.find(
    (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
  );
  if (marketMatch) {
    const hubLabel = locale === "id" ? "Intelijen Pasar" : "Market Intelligence";
    if (marketMatch.href === "/app/market") {
      return [
        { label: rootLabel, href: "/app" },
        { label: hubLabel },
      ];
    }
    return [
      { label: rootLabel, href: "/app" },
      { label: hubLabel, href: "/app/market" },
      { label: marketMatch.label[locale] },
    ];
  }

  const navMatch = WORKSPACE_NAV_ITEMS.find(
    (item) => item.id !== "overview" && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
  if (navMatch) {
    return [
      { label: rootLabel, href: "/app" },
      { label: navMatch.label[locale] },
    ];
  }

  if (pathname === "/app/ai" || pathname.startsWith("/app/ai/")) {
    return [{ label: rootLabel, href: "/app" }, { label: "CoinTrac AI" }];
  }

  if (pathname === "/app/admin" || pathname.startsWith("/app/admin/")) {
    return [{ label: rootLabel, href: "/app" }, { label: "Super Admin" }];
  }

  return [{ label: rootLabel, href: "/app" }];
}

export interface CommandItem {
  id: string;
  section: "Workspace" | "Market Intelligence" | "Crypto Assets" | "Tools & Documentation";
  title: string;
  subtitle: string;
  href: string;
  keywords: string[];
}

export const QUICK_JUMP_ASSETS: ReadonlyArray<{
  symbol: string;
  name: string;
  cmcId: number;
  category: { en: string; id: string };
  keywords: string[];
}> = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    cmcId: 1,
    category: { en: "CMC #1 · Benchmark & Dominance", id: "CMC #1 · Tolok Ukur & Dominasi" },
    keywords: ["btc", "bitcoin", "digital gold", "benchmark", "cmc 1"],
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    cmcId: 1027,
    category: { en: "CMC #1027 · Layer 1 Smart Contracts", id: "CMC #1027 · Kontrak Pintar Layer 1" },
    keywords: ["eth", "ethereum", "ether", "smart contract", "cmc 1027"],
  },
  {
    symbol: "SOL",
    name: "Solana",
    cmcId: 5426,
    category: { en: "CMC #5426 · High-Throughput Layer 1", id: "CMC #5426 · Layer 1 Throughput Tinggi" },
    keywords: ["sol", "solana", "spl", "cmc 5426"],
  },
  {
    symbol: "AVAX",
    name: "Avalanche",
    cmcId: 5805,
    category: { en: "CMC #5805 · Subnet Layer 1", id: "CMC #5805 · Subnet Layer 1" },
    keywords: ["avax", "avalanche", "subnet", "cmc 5805"],
  },
  {
    symbol: "LINK",
    name: "Chainlink",
    cmcId: 1975,
    category: { en: "CMC #1975 · Oracle & RWA Infrastructure", id: "CMC #1975 · Infrastruktur Oracle & RWA" },
    keywords: ["link", "chainlink", "oracle", "ccip", "cmc 1975"],
  },
  {
    symbol: "ONDO",
    name: "Ondo",
    cmcId: 21159,
    category: { en: "CMC #21159 · Real World Assets (RWA)", id: "CMC #21159 · Real World Assets (RWA)" },
    keywords: ["ondo", "rwa", "treasury", "real world assets", "cmc 21159"],
  },
  {
    symbol: "NEAR",
    name: "NEAR Protocol",
    cmcId: 6535,
    category: { en: "CMC #6535 · AI & Sharded Layer 1", id: "CMC #6535 · AI & Sharded Layer 1" },
    keywords: ["near", "near protocol", "sharding", "cmc 6535"],
  },
  {
    symbol: "UNI",
    name: "Uniswap",
    cmcId: 7083,
    category: { en: "CMC #7083 · DeFi Spot Liquidity", id: "CMC #7083 · Likuiditas Spot DeFi" },
    keywords: ["uni", "uniswap", "dex", "amm", "cmc 7083"],
  },
];

export function buildWorkspaceCommands(locale: Locale): CommandItem[] {
  const navCommands: CommandItem[] = WORKSPACE_NAV_ITEMS.map((item) => ({
    id: `nav-${item.id}`,
    section: "Workspace",
    title: item.label[locale],
    subtitle: item.description[locale],
    href: item.href,
    keywords: [item.id, item.label.en, item.label.id, item.href],
  }));

  const marketCommands: CommandItem[] = MARKET_SUB_ROUTES.filter(
    (route) => route.href !== "/app/market",
  ).map((route) => ({
    id: `market-${route.href}`,
    section: "Market Intelligence",
    title: route.label[locale],
    subtitle: route.href,
    href: route.href,
    keywords: [...route.keywords, route.label.en, route.label.id, route.href],
  }));

  const assetCommands: CommandItem[] = QUICK_JUMP_ASSETS.map((asset) => ({
    id: `asset-${asset.symbol.toLowerCase()}`,
    section: "Crypto Assets",
    title: `${asset.symbol} · ${asset.name}`,
    subtitle: asset.category[locale],
    href: `/app/assets?symbol=${asset.symbol}`,
    keywords: [...asset.keywords, asset.symbol, asset.name],
  }));

  const docCommands: CommandItem[] = [
    {
      id: "workspace-cointrac-ai",
      section: "Workspace",
      title: "CoinTrac AI",
      subtitle:
        locale === "id"
          ? "Analis AI Muse Spark 1.3 dengan tool calling & bukti audit"
          : "Muse Spark 1.3 market analyst with deterministic tool calling",
      href: "/app/ai",
      keywords: ["ai", "cointrac ai", "muse", "spark", "chat", "copilot", "analyst"],
    },
    {
      id: "tool-playground",
      section: "Tools & Documentation",
      title: locale === "id" ? "API Playground" : "API Playground",
      subtitle:
        locale === "id"
          ? "Jalankan 10 tool intelligence secara interaktif"
          : "Run all 10 intelligence tools interactively",
      href: "/playground",
      keywords: ["playground", "rest", "explorer", "test", "json"],
    },
    {
      id: "doc-reference",
      section: "Tools & Documentation",
      title: locale === "id" ? "Dokumentasi CoinTrac" : "CoinTrac Documentation",
      subtitle: "/docs",
      href: "/docs",
      keywords: ["docs", "documentation", "api", "mcp", "guide"],
    },
    {
      id: "doc-capabilities",
      section: "Tools & Documentation",
      title: locale === "id" ? "Katalog Produk (10 Tools)" : "Product Catalog (10 Tools)",
      subtitle: "/product",
      href: "/product",
      keywords: ["product", "capabilities", "tools", "catalog", "resources", "prompts"],
    },
    {
      id: "doc-integrations",
      section: "Tools & Documentation",
      title: locale === "id" ? "Integrasi & Klien MCP" : "MCP Client Integrations",
      subtitle: "/integrations",
      href: "/integrations",
      keywords: ["integrations", "cursor", "claude", "antigravity", "mcp"],
    },
    {
      id: "doc-connect",
      section: "Tools & Documentation",
      title: locale === "id" ? "Snippet Koneksi Cepat" : "Developer Connect Snippets",
      subtitle: "/connect",
      href: "/connect",
      keywords: ["connect", "curl", "python", "snippet", "setup"],
    },
  ];

  return [...navCommands, ...marketCommands, ...assetCommands, ...docCommands];
}

export function filterWorkspaceCommands(commands: CommandItem[], rawQuery: string): CommandItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return commands;
  const terms = query.split(/\s+/).filter(Boolean);
  return commands.filter((cmd) => {
    const haystack = [cmd.title, cmd.subtitle, cmd.section, ...cmd.keywords]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export const MARKET_INTELLIGENCE_TOOL_NAMES = new Set<string>([
  "get_market_overview",
  "analyze_market_regime",
  "scan_market_movers",
  "detect_market_anomalies",
  "compare_assets",
  "analyze_asset",
  "analyze_momentum",
  "analyze_sector_rotation",
  "get_historical_performance",
  "analyze_derivatives",
]);

export function isMarketIntelligenceTool(toolName: string | null | undefined): boolean {
  return typeof toolName === "string" && MARKET_INTELLIGENCE_TOOL_NAMES.has(toolName);
}

export type OnboardingStepStatus =
  | "loading"
  | "action_required"
  | "configured"
  | "verified"
  | "unverified";

export interface OnboardingStep {
  id: "api_key" | "connect_mcp" | "first_query";
  stepNumber: 1 | 2 | 3;
  status: OnboardingStepStatus;
  badgeLabel: string;
  href: string;
  ctaLabel: string;
  statusNote: string;
}

export interface OnboardingSignals {
  keysLoading?: boolean;
  keysLoaded: boolean;
  activeKeyCount: number | null;
  revokedKeyCount?: number;
  verifiedKeyCount?: number;
  usageLoading?: boolean;
  usageLoaded: boolean;
  callsLast30d: number | null;
  mcpCalls: number | null;
  successfulMcpCalls?: number;
  failedMcpCalls?: number;
  successfulMarketUsageQueries?: number;
  mcpStatusLoading?: boolean;
  mcpStatusLoaded: boolean;
  remoteMcpDeployed: boolean;
  evidenceLoading?: boolean;
  evidenceLoaded?: boolean;
  verifiedMarketEvidenceCount?: number;
}

/**
 * Derive truthful 3-step onboarding state strictly from live backend signals.
 * Distinguishes loading, configured (present but unverified auth), verified
 * (observed live success), action_required, and unverified (error/no signal).
 * Never fabricates completion or conflates unrelated requests with intelligence queries.
 */
export function computeOnboardingSteps(signals: OnboardingSignals): OnboardingStep[] {
  const revokedKeys = signals.revokedKeyCount ?? 0;
  const verifiedKeys = signals.verifiedKeyCount ?? 0;
  const remoteLabel = signals.mcpStatusLoaded
    ? signals.remoteMcpDeployed
      ? "Hosted Remote MCP is deployed."
      : "Local MCP is available; hosted Remote MCP is Not deployed."
    : "Remote MCP deployment status could not be verified.";

  // Step 1: API key presence (configured) vs verified authentication (last_used_at present)
  let step1: OnboardingStep;
  if (signals.keysLoading) {
    step1 = {
      id: "api_key",
      stepNumber: 1,
      status: "loading",
      badgeLabel: "CHECKING",
      href: "/app/keys",
      ctaLabel: "Open API Keys",
      statusNote: "Checking personal API keys for this account...",
    };
  } else if (!signals.keysLoaded || signals.activeKeyCount === null) {
    step1 = {
      id: "api_key",
      stepNumber: 1,
      status: "unverified",
      badgeLabel: "UNVERIFIED",
      href: "/app/keys",
      ctaLabel: "Open API Keys",
      statusNote: "Unable to verify API keys right now (keys endpoint unavailable).",
    };
  } else if (signals.activeKeyCount === 0) {
    step1 = {
      id: "api_key",
      stepNumber: 1,
      status: "action_required",
      badgeLabel: "NOT CONFIGURED",
      href: "/app/keys",
      ctaLabel: "Create API key",
      statusNote:
        revokedKeys > 0
          ? `0 active keys (${revokedKeys} revoked key${revokedKeys === 1 ? "" : "s"} only). Create a new ct_live_* key.`
          : "No active personal API key created yet.",
    };
  } else if (verifiedKeys > 0) {
    step1 = {
      id: "api_key",
      stepNumber: 1,
      status: "verified",
      badgeLabel: "VERIFIED",
      href: "/app/keys",
      ctaLabel: "Manage API Keys",
      statusNote: `${signals.activeKeyCount} active key${signals.activeKeyCount === 1 ? "" : "s"} present; ${verifiedKeys} verified via live API authentication.`,
    };
  } else {
    step1 = {
      id: "api_key",
      stepNumber: 1,
      status: "configured",
      badgeLabel: "CONFIGURED",
      href: "/app/keys",
      ctaLabel: "Manage API Keys",
      statusNote: `${signals.activeKeyCount} active key${signals.activeKeyCount === 1 ? "" : "s"} configured. Key authentication remains unverified until its first live request.`,
    };
  }

  // Step 2: Distinguish Local MCP availability, observed MCP usage, and Remote MCP deployment
  const successMcp = signals.successfulMcpCalls ?? 0;
  const failedMcp = signals.failedMcpCalls ?? 0;
  let step2: OnboardingStep;
  if (signals.usageLoading || signals.mcpStatusLoading) {
    step2 = {
      id: "connect_mcp",
      stepNumber: 2,
      status: "loading",
      badgeLabel: "CHECKING",
      href: "/app/connections",
      ctaLabel: "Open MCP Connections",
      statusNote: "Checking MCP transport status and account telemetry...",
    };
  } else if (!signals.usageLoaded || signals.mcpCalls === null) {
    step2 = {
      id: "connect_mcp",
      stepNumber: 2,
      status: "unverified",
      badgeLabel: "UNVERIFIED",
      href: "/app/connections",
      ctaLabel: "Open MCP Connections",
      statusNote: `Usage telemetry unavailable; MCP activity cannot be verified. ${remoteLabel}`,
    };
  } else if (signals.mcpCalls > 0 && (successMcp > 0 || failedMcp === 0)) {
    step2 = {
      id: "connect_mcp",
      stepNumber: 2,
      status: "verified",
      badgeLabel: "USAGE OBSERVED",
      href: "/app/connections",
      ctaLabel: "View MCP Connections",
      statusNote: `${signals.mcpCalls} MCP call${signals.mcpCalls === 1 ? "" : "s"} observed in telemetry. Local client config is user-managed. ${remoteLabel}`,
    };
  } else if (signals.mcpCalls > 0 && successMcp === 0 && failedMcp > 0) {
    step2 = {
      id: "connect_mcp",
      stepNumber: 2,
      status: "unverified",
      badgeLabel: "UNVERIFIED",
      href: "/app/connections",
      ctaLabel: "Review MCP Connections",
      statusNote: `Recent MCP requests returned errors with no successful 2xx call verified. ${remoteLabel}`,
    };
  } else {
    step2 = {
      id: "connect_mcp",
      stepNumber: 2,
      status: "unverified",
      badgeLabel: "UNVERIFIED",
      href: "/app/connections",
      ctaLabel: "Open MCP Connections",
      statusNote: `No MCP calls recorded yet. ${remoteLabel}`,
    };
  }

  // Step 3: Require verified successful Market Intelligence query (evidence or 2xx intelligence tool call)
  const verifiedEvidence = signals.verifiedMarketEvidenceCount ?? 0;
  const verifiedUsageQueries = signals.successfulMarketUsageQueries ?? 0;
  const evidenceLoaded = signals.evidenceLoaded ?? false;
  const anyVerifiedQuery = verifiedEvidence > 0 || verifiedUsageQueries > 0;
  let step3: OnboardingStep;
  if (signals.usageLoading && signals.evidenceLoading) {
    step3 = {
      id: "first_query",
      stepNumber: 3,
      status: "loading",
      badgeLabel: "CHECKING",
      href: "/app/market",
      ctaLabel: "Open Market Intelligence",
      statusNote: "Checking Market Intelligence query and evidence history...",
    };
  } else if (anyVerifiedQuery) {
    const count = Math.max(verifiedEvidence, verifiedUsageQueries);
    step3 = {
      id: "first_query",
      stepNumber: 3,
      status: "verified",
      badgeLabel: "VERIFIED",
      href: "/app/evidence",
      ctaLabel: "Inspect Evidence",
      statusNote: `${count} verified Market Intelligence quer${count === 1 ? "y" : "ies"} with auditable output recorded.`,
    };
  } else if (!evidenceLoaded && !signals.usageLoaded) {
    step3 = {
      id: "first_query",
      stepNumber: 3,
      status: "unverified",
      badgeLabel: "UNVERIFIED",
      href: "/app/market",
      ctaLabel: "Open Market Intelligence",
      statusNote: "Usage and evidence endpoints could not be verified right now.",
    };
  } else if (!evidenceLoaded || !signals.usageLoaded) {
    step3 = {
      id: "first_query",
      stepNumber: 3,
      status: "unverified",
      badgeLabel: "UNVERIFIED",
      href: "/app/market",
      ctaLabel: "Open Market Intelligence",
      statusNote:
        "No successful Market Intelligence query found in available records; one telemetry source is currently unavailable.",
    };
  } else if ((signals.callsLast30d ?? 0) > 0) {
    step3 = {
      id: "first_query",
      stepNumber: 3,
      status: "action_required",
      badgeLabel: "NEXT STEP",
      href: "/app/market",
      ctaLabel: "Run first query",
      statusNote:
        "No successful Market Intelligence query verified yet (failed or non-intelligence requests do not complete this step).",
    };
  } else {
    step3 = {
      id: "first_query",
      stepNumber: 3,
      status: "action_required",
      badgeLabel: "NEXT STEP",
      href: "/app/market",
      ctaLabel: "Run first query",
      statusNote: "No Market Intelligence queries recorded for this account yet.",
    };
  }

  return [step1, step2, step3];
}

export function derivePrimaryNextAction(steps: OnboardingStep[]): {
  label: string;
  href: string;
} {
  if (steps.every((step) => step.status === "loading")) {
    return { label: "Open Market Intelligence", href: "/app/market" };
  }
  const pending = steps.find((step) => step.status === "action_required");
  if (pending) {
    return { label: pending.ctaLabel, href: pending.href };
  }
  const unverifiedMcp = steps.find(
    (step) => step.id === "connect_mcp" && step.status !== "verified" && step.status !== "loading",
  );
  if (unverifiedMcp) {
    return { label: "Configure MCP Client", href: "/app/connections" };
  }
  return { label: "Open Market Intelligence", href: "/app/market" };
}

export function isKnownMarketSubRoute(href: string): boolean {
  return MARKET_ROUTE_SET.has(href);
}
