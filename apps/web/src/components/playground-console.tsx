"use client";

import {
  Activity,
  ChevronDown,
  ChevronUp,
  Code2,
  Eye,
  GitCompareArrows,
  History,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  Trash2,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { runIntelligenceTool } from "@/lib/api";
import {
  PLAYGROUND_PRESETS,
  SECTOR_OPTIONS,
  TOOL_CATALOG,
  publicMcpUrl,
  publicOpenApiDocsUrl,
  type PlaygroundPreset,
} from "@/lib/catalog";
import { formatDurationMs } from "@/lib/format";
import {
  PLAYGROUND_TOOL_GROUPS,
  getPresetSampleEnvelopes,
  getSampleEnvelopeForTool,
  type PlaygroundToolGroup,
} from "@/lib/playground-samples";
import {
  probeAccountSession,
  probeSession,
  type AccountSessionStatus,
  type SessionProbe,
} from "@/lib/session-probe";
import { validateToolInput } from "@/lib/tool-input";
import type { EvidenceEnvelope, RankBy, SectorSlug, ToolName } from "@/lib/types";
import { workspaceCopy } from "@/lib/workspace-copy";
import { ApiNotice } from "./api-notice";
import { useAppPreferences } from "./app-preferences";
import { CopyButton } from "./copy-button";
import {
  EnvelopeEvidenceView,
  EnvelopeFormattedReport,
} from "./envelope-report";
import { JsonViewer } from "./json-viewer";

type OutputTab = "report" | "json" | "evidence" | "request";
type OutputSourceMode = "sample" | "live";
type RequestSnippetLang = "curl" | "mcp" | "python";
type ToolGroupFilter = "all" | PlaygroundToolGroup["id"];

const QUICK_SYMBOLS = ["BTC", "ETH", "SOL", "AVAX", "LINK"] as const;
const QUICK_SYMBOL_SETS = ["SOL, AVAX, NEAR", "BTC, ETH, SOL"] as const;
const MAX_HISTORY_ITEMS = 5;

interface RunOutcome {
  id: string;
  label: string;
  tool: ToolName;
  envelopes: EvidenceEnvelope[];
  latencyMs: number;
  error?: {
    status: number;
    message: string;
    retryAfterSeconds?: number;
  };
}

const PRESET_ICONS = {
  "daily-briefing": Activity,
  "anti-chase": TrendingUp,
  "compare-l1": GitCompareArrows,
  "sector-rwa": Layers,
} as const;

const PRESET_ACCENTS = {
  "daily-briefing": "bg-primary/15 text-primary",
  "anti-chase": "bg-positive/15 text-positive",
  "compare-l1": "bg-primary/15 text-primary",
  "sector-rwa": "bg-accent/15 text-accent",
} as const;

const TOOL_SCHEMA_TAG: Record<
  ToolName,
  { badge: string; toneClass: string }
> = {
  get_market_overview: { badge: "OK", toneClass: "text-positive border-positive/30 bg-positive/10" },
  analyze_market_regime: { badge: "OK", toneClass: "text-positive border-positive/30 bg-positive/10" },
  scan_market_movers: { badge: "OK", toneClass: "text-positive border-positive/30 bg-positive/10" },
  compare_assets: { badge: "OK / PARTIAL", toneClass: "text-link border-primary/30 bg-primary/10" },
  analyze_asset: { badge: "PARTIAL", toneClass: "text-accent border-accent/35 bg-accent/10" },
  analyze_momentum: { badge: "OK", toneClass: "text-positive border-positive/30 bg-positive/10" },
  detect_market_anomalies: { badge: "OK", toneClass: "text-positive border-positive/30 bg-positive/10" },
  analyze_sector_rotation: { badge: "OK", toneClass: "text-positive border-positive/30 bg-positive/10" },
  get_historical_performance: { badge: "BYOK OHLCV", toneClass: "text-accent border-accent/35 bg-accent/10" },
  analyze_derivatives: { badge: "PARTIAL / PROXY", toneClass: "text-link border-primary/30 bg-primary/10" },
};

function parseSymbolList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const INPUT_CLASS =
  "mt-1.5 min-h-11 sm:min-h-10 w-full rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary focus:outline-none";

export interface PlaygroundConsoleProps {
  initialAuthenticated?: boolean;
  initialEmail?: string | null;
}

export function PlaygroundConsole({
  initialAuthenticated = false,
  initialEmail = null,
}: PlaygroundConsoleProps = {}) {
  const { t, locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const [session, setSession] = useState<SessionProbe | "unknown">(
    initialAuthenticated ? "authenticated" : "unknown",
  );
  const [accountAuth, setAccountAuth] = useState<
    AccountSessionStatus["status"] | "unknown"
  >(initialAuthenticated ? "authenticated" : "unknown");
  const [accountEmail, setAccountEmail] = useState<string | null>(initialEmail);
  const [selectedTool, setSelectedTool] = useState<ToolName>("compare_assets");
  const [groupFilter, setGroupFilter] = useState<ToolGroupFilter>("all");
  const [quoteCurrency, setQuoteCurrency] = useState("USD");
  const [symbol, setSymbol] = useState("SOL");
  const [symbolsInput, setSymbolsInput] = useState("SOL, AVAX, NEAR");
  const [count, setCount] = useState("30");
  const [universeSize, setUniverseSize] = useState("150");
  const [limit, setLimit] = useState("15");
  const [rankBy, setRankBy] = useState<RankBy>("composite_momentum_score");
  const [minMarketCap, setMinMarketCap] = useState("250000000");
  const [minVolume24h, setMinVolume24h] = useState("15000000");
  const [minVolToMcap, setMinVolToMcap] = useState("");
  const [minRs7d, setMinRs7d] = useState("");
  const [max24hGain, setMax24hGain] = useState("18");
  const [max7dGain, setMax7dGain] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<SectorSlug[]>(
    SECTOR_OPTIONS.map((s) => s.slug),
  );

  // BYOK key stays strictly in React state (memory only, never localStorage).
  const [byokOpen, setByokOpen] = useState(false);
  const [byokKey, setByokKey] = useState("");

  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [outputTab, setOutputTab] = useState<OutputTab>("report");
  const [outputSource, setOutputSource] = useState<OutputSourceMode>("sample");
  const [snippetLang, setSnippetLang] = useState<RequestSnippetLang>("curl");
  const [running, setRunning] = useState(false);
  const [runSeq, setRunSeq] = useState(0);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [runHistory, setRunHistory] = useState<RunOutcome[]>([]);

  const currentToolMeta =
    TOOL_CATALOG.find((item) => item.name === selectedTool) ?? TOOL_CATALOG[0];

  useEffect(() => {
    let cancelled = false;
    void Promise.all([probeAccountSession(), probeSession()]).then(
      ([acct, backend]) => {
        if (cancelled) return;
        setAccountAuth(acct.status);
        setAccountEmail(acct.email);
        setSession(backend);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const isSignedIn =
    accountAuth === "authenticated" || session === "authenticated";

  function recordOutcome(next: Omit<RunOutcome, "id">) {
    const nextSeq = runSeq + 1;
    setRunSeq(nextSeq);
    const entry: RunOutcome = {
      ...next,
      id: `${next.tool}-${nextSeq}`,
    };
    setOutcome(entry);
    setOutputSource("live");
    if (entry.envelopes.length > 0 && !entry.error) {
      setRunHistory((prev) =>
        [entry, ...prev.filter((item) => item.id !== entry.id)].slice(
          0,
          MAX_HISTORY_ITEMS,
        ),
      );
    }
  }

  async function ensureSession(): Promise<boolean> {
    const [acct, next] = await Promise.all([
      probeAccountSession(),
      probeSession(),
    ]);
    setAccountAuth(acct.status);
    setAccountEmail(acct.email);
    setSession(next);

    if (next === "authenticated") return true;

    if (acct.status === "authenticated") {
      recordOutcome({
        label: currentToolMeta.label,
        tool: selectedTool,
        envelopes: [],
        latencyMs: 0,
        error: {
          status: 503,
          message:
            locale === "id"
              ? "Anda sudah masuk, namun server Intelligence API belum merespons. Pastikan backend FastAPI berjalan lalu coba lagi."
              : "Your session is signed in, but the Intelligence API server is unreachable. Start the FastAPI backend and retry.",
        },
      });
      return false;
    }

    recordOutcome({
      label: currentToolMeta.label,
      tool: selectedTool,
      envelopes: [],
      latencyMs: 0,
      error: {
        status: next === "anonymous" || acct.status === "anonymous" ? 401 : 503,
        message:
          next === "anonymous" || acct.status === "anonymous"
            ? copy.signInBody
            : copy.sessionFailed,
      },
    });
    return false;
  }

  function toggleSector(slug: SectorSlug) {
    setSelectedSectors((prev) =>
      prev.includes(slug) ? prev.filter((item) => item !== slug) : [...prev, slug],
    );
  }

  function buildParamsForTool(tool: ToolName): Record<string, unknown> {
    const base = { quote_currency: quoteCurrency.trim().toUpperCase() || "USD" };
    switch (tool) {
      case "get_market_overview":
      case "analyze_market_regime":
        return base;
      case "scan_market_movers":
        return {
          ...base,
          min_market_cap_usd: parseOptionalNumber(minMarketCap),
          min_volume_24h_usd: parseOptionalNumber(minVolume24h),
          min_vol_to_mcap: parseOptionalNumber(minVolToMcap),
          min_rs_vs_btc_7d: parseOptionalNumber(minRs7d),
          max_24h_gain_pct: parseOptionalNumber(max24hGain),
          max_7d_gain_pct: parseOptionalNumber(max7dGain),
          rank_by: rankBy,
          limit: parseOptionalNumber(limit) ?? 20,
          universe_size: parseOptionalNumber(universeSize) ?? 150,
        };
      case "compare_assets":
      case "analyze_momentum":
        return {
          ...base,
          symbols: parseSymbolList(symbolsInput),
        };
      case "analyze_asset":
      case "analyze_derivatives":
        return {
          ...base,
          symbol: symbol.trim().toUpperCase() || "SOL",
        };
      case "get_historical_performance":
        return {
          ...base,
          symbol: symbol.trim().toUpperCase() || "SOL",
          count: parseOptionalNumber(count) ?? 30,
        };
      case "detect_market_anomalies":
        return {
          ...base,
          universe_size: parseOptionalNumber(universeSize) ?? 150,
        };
      case "analyze_sector_rotation":
        return {
          ...base,
          sectors: selectedSectors.length > 0 ? selectedSectors : null,
        };
    }
  }

  async function executeSingleTool(
    tool: ToolName,
    params: Record<string, unknown>,
    label: string,
  ) {
    if (!(await ensureSession())) return;
    setRunning(true);
    setOutputSource("live");
    const res = await runIntelligenceTool(tool, params, {
      byok: byokKey || undefined,
    });
    setRunning(false);

    if (!res.ok) {
      recordOutcome({
        label,
        tool,
        envelopes: [],
        latencyMs: res.latencyMs,
        error: {
          status: res.status,
          message: res.message,
          retryAfterSeconds: res.retryAfterSeconds,
        },
      });
      return;
    }

    recordOutcome({
      label,
      tool,
      envelopes: [res.data],
      latencyMs: res.latencyMs,
    });
  }

  function applyPresetParams(preset: PlaygroundPreset) {
    setActivePresetId(preset.id);
    setSelectedTool(preset.primaryTool);

    const params = preset.defaultParams;
    if (typeof params.quote_currency === "string") {
      setQuoteCurrency(params.quote_currency);
    }
    if (Array.isArray(params.symbols)) {
      setSymbolsInput(params.symbols.join(", "));
    }
    if (typeof params.min_market_cap_usd === "number") {
      setMinMarketCap(String(params.min_market_cap_usd));
    }
    if (typeof params.min_volume_24h_usd === "number") {
      setMinVolume24h(String(params.min_volume_24h_usd));
    }
    if (typeof params.max_24h_gain_pct === "number") {
      setMax24hGain(String(params.max_24h_gain_pct));
    }
    setMax7dGain(
      typeof params.max_7d_gain_pct === "number"
        ? String(params.max_7d_gain_pct)
        : "",
    );
    if (typeof params.limit === "number") {
      setLimit(String(params.limit));
    }
    if (Array.isArray(params.sectors)) {
      setSelectedSectors(params.sectors as SectorSlug[]);
    }
  }

  async function handleRunPreset(preset: PlaygroundPreset) {
    applyPresetParams(preset);
    const params = preset.defaultParams;

    // Anonymous visitors get instant Sample Schema visual preview instead of hitting a blocking 401 wall.
    if (!isSignedIn) {
      setOutputSource("sample");
      if (outputTab === "request") {
        setOutputTab("report");
      }
      return;
    }

    if (!preset.pairedTool) {
      await executeSingleTool(preset.primaryTool, params, preset.title);
      return;
    }

    if (!(await ensureSession())) return;
    setRunning(true);
    setOutputSource("live");
    const [first, second] = await Promise.all([
      runIntelligenceTool(preset.primaryTool, params, {
        byok: byokKey || undefined,
      }),
      runIntelligenceTool(preset.pairedTool, params, {
        byok: byokKey || undefined,
      }),
    ]);
    const totalLatency = Math.max(first.latencyMs, second.latencyMs);
    setRunning(false);

    const envelopes: EvidenceEnvelope[] = [];
    if (second.ok) envelopes.push(second.data);
    if (first.ok) envelopes.push(first.data);

    const failed = !first.ok ? first : !second.ok ? second : null;
    recordOutcome({
      label: preset.title,
      tool: preset.primaryTool,
      envelopes,
      latencyMs: totalLatency,
      error: failed
        ? {
            status: failed.status,
            message: failed.message,
            retryAfterSeconds: failed.retryAfterSeconds,
          }
        : undefined,
    });
  }

  function selectToolAndPreview(toolName: ToolName) {
    setSelectedTool(toolName);
    setActivePresetId(null);
    if (!outcome || outcome.tool !== toolName) {
      setOutputSource("sample");
    }
  }

  function resetDefaults() {
    setQuoteCurrency("USD");
    setSymbol("SOL");
    setSymbolsInput("SOL, AVAX, NEAR");
    setCount("30");
    setUniverseSize("150");
    setLimit("15");
    setRankBy("composite_momentum_score");
    setMinMarketCap("250000000");
    setMinVolume24h("15000000");
    setMinVolToMcap("");
    setMinRs7d("");
    setMax24hGain("18");
    setMax7dGain("");
    setSelectedSectors(SECTOR_OPTIONS.map((s) => s.slug));
    setActivePresetId(null);
  }

  async function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActivePresetId(null);
    const params = buildParamsForTool(selectedTool);

    const invalid = validateToolInput(selectedTool, params);
    if (invalid) {
      recordOutcome({
        label: currentToolMeta.label,
        tool: selectedTool,
        envelopes: [],
        latencyMs: 0,
        error: { status: 400, message: invalid },
      });
      return;
    }

    await executeSingleTool(selectedTool, params, currentToolMeta.label);
  }

  const activePreset = activePresetId
    ? PLAYGROUND_PRESETS.find((p) => p.id === activePresetId) ?? null
    : null;

  const sampleEnvelopes = activePreset
    ? getPresetSampleEnvelopes(
        activePreset.primaryTool,
        activePreset.pairedTool,
        locale,
      )
    : [getSampleEnvelopeForTool(selectedTool, locale)];

  const showingLive = outputSource === "live" && outcome !== null;
  const activeEnvelopes = showingLive ? outcome.envelopes : sampleEnvelopes;

  const visibleToolNames =
    groupFilter === "all"
      ? TOOL_CATALOG.map((item) => item.name)
      : PLAYGROUND_TOOL_GROUPS.find((g) => g.id === groupFilter)?.tools ?? [];

  const liveParams = buildParamsForTool(selectedTool);
  const apiBase = publicOpenApiDocsUrl().replace(/\/docs$/, "");
  const mcpEndpoint = publicMcpUrl();
  const resolvedGetPath = currentToolMeta.restPath.replace(
    "{symbol}",
    encodeURIComponent(symbol.trim().toUpperCase() || "SOL"),
  );
  const liveCurl =
    currentToolMeta.method === "GET"
      ? `curl -sf -H "x-cointrac-key: <YOUR_COINTRAC_API_KEY>" \\\n  "${apiBase}${resolvedGetPath}"`
      : `curl -sf -X POST \\\n  -H "x-cointrac-key: <YOUR_COINTRAC_API_KEY>" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(liveParams)}' \\\n  "${apiBase}${currentToolMeta.restPath}"`;

  const liveMcpPayload = JSON.stringify(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: selectedTool,
        arguments: liveParams,
      },
    },
    null,
    2,
  );

  const livePythonSnippet =
    currentToolMeta.method === "GET"
      ? `import httpx\n\nresp = httpx.get(\n    "${apiBase}${resolvedGetPath}",\n    headers={"x-cointrac-key": "<YOUR_COINTRAC_API_KEY>"},\n    params={"quote_currency": ${JSON.stringify(liveParams.quote_currency ?? "USD")}},\n)\nenvelope = resp.json()\nprint(envelope["status"], envelope["evidence"]["evidence_id"])`
      : `import httpx\n\nresp = httpx.post(\n    "${apiBase}${currentToolMeta.restPath}",\n    headers={"x-cointrac-key": "<YOUR_COINTRAC_API_KEY>"},\n    json=${JSON.stringify(liveParams, null, 4)},\n)\nenvelope = resp.json()\nprint(envelope["status"], envelope["evidence"]["evidence_id"])`;

  const snippetContent =
    snippetLang === "curl"
      ? liveCurl
      : snippetLang === "mcp"
        ? liveMcpPayload
        : livePythonSnippet;

  return (
    <div className="space-y-6">
      {/* Interactive Onboarding Strip + Auth Banner */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            step: "01",
            title:
              locale === "id"
                ? "Pilih Tool atau Preset"
                : "Pick Tool or Preset",
            desc:
              locale === "id"
                ? "Jelajahi 10 intelligence tools & 4 skenario preset terkurasi."
                : "Browse 10 intelligence tools across macro, screening & risk.",
          },
          {
            step: "02",
            title:
              locale === "id"
                ? "Preview Skema Output"
                : "Inspect Visual Schema",
            desc:
              locale === "id"
                ? "Lihat langsung grafik, tabel null-safe, JSON, dan audit provenance."
                : "Explore formatted charts, null-safe tables, JSON & provenance immediately.",
          },
          {
            step: "03",
            title:
              locale === "id"
                ? "Eksekusi Live & Salin Kode"
                : "Execute Live & Export",
            desc:
              locale === "id"
                ? "Jalankan dengan sesi Anda atau salin snippet cURL / MCP / Python."
                : "Run against live CMC data or copy ready-made cURL, MCP & Python code.",
          },
        ].map((guide) => (
          <div
            key={guide.step}
            className="ct-surface-card flex items-start gap-3 rounded-[14px] px-4 py-3"
          >
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/12 font-mono text-[11px] font-bold text-link">
              {guide.step}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{guide.title}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {guide.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      {isSignedIn ? (
        <div className="ct-surface-card flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/35 bg-positive/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-positive">
              <span className="h-1.5 w-1.5 rounded-full bg-positive" aria-hidden="true" />
              {locale === "id" ? "Sesi Aktif" : "Signed In"}
            </span>
            <span className="font-mono text-foreground">
              {accountEmail ?? (locale === "id" ? "Akun terverifikasi" : "Verified account")}
            </span>
            {session === "unavailable" ? (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 font-mono text-[10.5px] text-accent">
                {locale === "id"
                  ? "Intelligence API offline · Preview skema tersedia"
                  : "Intelligence API offline · Schema preview active"}
              </span>
            ) : null}
          </div>
          <Link
            href="/app"
            className="font-mono text-xs font-semibold text-link transition-colors hover:underline"
          >
            {locale === "id" ? "Buka Dashboard →" : "Open Workspace →"}
          </Link>
        </div>
      ) : accountAuth === "anonymous" || session === "anonymous" ? (
        <div className="ct-surface-featured flex flex-col justify-between gap-4 rounded-[16px] px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-primary/35 bg-primary/12 text-link">
              <Eye className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {locale === "id"
                  ? "Mode Preview Skema Aktif — Masuk untuk Eksekusi Live"
                  : "Schema Preview Active — Sign In for Live Execution"}
              </p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {copy.signInBody}
              </p>
            </div>
          </div>
          <Link
            href="/login?next=/playground"
            className="tg-btn tg-btn-primary ct-btn-glow inline-flex shrink-0"
          >
            {copy.signIn}
          </Link>
        </div>
      ) : null}

      {/* Curated Presets */}
      <section aria-labelledby="presets-heading" className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="presets-heading"
            className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {t.playground.presetsHeading}
          </h2>
          <span className="font-mono text-[11px] text-subtle-foreground">
            {isSignedIn
              ? locale === "id"
                ? "Klik preset untuk langsung menjalankan live"
                : "Click any preset to execute live"
              : locale === "id"
                ? "Klik preset untuk memuat parameter & preview hasil"
                : "Click any preset to load params & inspect sample output"}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAYGROUND_PRESETS.map((preset) => {
            const active = activePresetId === preset.id;
            const Icon =
              PRESET_ICONS[preset.id as keyof typeof PRESET_ICONS] ?? Activity;
            const iconAccent =
              PRESET_ACCENTS[preset.id as keyof typeof PRESET_ACCENTS] ??
              "bg-primary/15 text-link";

            return (
              <button
                key={preset.id}
                type="button"
                disabled={running}
                onClick={() => handleRunPreset(preset)}
                className={`ct-surface-card group flex cursor-pointer flex-col justify-between rounded-[14px] p-3.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? "border-primary/60 bg-card-elevated ring-1 ring-primary/40"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${iconAccent}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[13px] font-semibold leading-snug text-foreground">
                        {preset.title}
                      </p>
                      <span className="mt-0.5 inline-block font-mono text-[10px] text-subtle-foreground">
                        {preset.badge}
                      </span>
                    </div>
                  </div>
                  {isSignedIn ? (
                    <Play
                      className="mt-1 h-3.5 w-3.5 shrink-0 text-subtle-foreground transition-colors group-hover:text-link"
                      aria-hidden="true"
                    />
                  ) : (
                    <Eye
                      className="mt-1 h-3.5 w-3.5 shrink-0 text-subtle-foreground transition-colors group-hover:text-link"
                      aria-hidden="true"
                    />
                  )}
                </div>

                <p className="mt-2.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  {preset.subtitle}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Split Studio: Left Tool Navigator & Params + Right Interactive Output Studio */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Rail */}
        <section
          aria-labelledby="tool-runner-heading"
          className="space-y-4 lg:col-span-4"
        >
          <form
            onSubmit={handleFormSubmit}
            className="ct-surface-featured space-y-5 rounded-[18px] p-5"
          >
            {/* Visual Tool Navigator */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  id="tool-runner-heading"
                  className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {t.playground.toolRunnerLabel} ({TOOL_CATALOG.length})
                </span>
                <button
                  type="button"
                  onClick={resetDefaults}
                  className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] text-subtle-foreground transition-colors hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  <span>Reset</span>
                </button>
              </div>

              {/* Group Filter Pills */}
              <div
                role="group"
                aria-label="Filter tools by category"
                className="flex flex-wrap gap-1.5"
              >
                {(
                  [
                    { id: "all", label: locale === "id" ? "Semua (10)" : "All (10)" },
                    ...PLAYGROUND_TOOL_GROUPS.map((g) => ({
                      id: g.id,
                      label: locale === "id" ? g.labelId : g.labelEn,
                    })),
                  ] as const
                ).map((tab) => {
                  const active = groupFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setGroupFilter(tab.id)}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors ${
                        active
                          ? "border-primary/60 bg-primary/15 text-link"
                          : "border-border bg-background/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Interactive Tool List */}
              <div
                role="listbox"
                aria-label={t.playground.toolRunnerLabel}
                className="grid max-h-[260px] gap-1.5 overflow-y-auto pr-1"
              >
                {TOOL_CATALOG.filter((tool) =>
                  visibleToolNames.includes(tool.name),
                ).map((tool) => {
                  const active = selectedTool === tool.name;
                  const schemaTag = TOOL_SCHEMA_TAG[tool.name];
                  return (
                    <button
                      key={tool.name}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => selectToolAndPreview(tool.name)}
                      className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-left transition-all ${
                        active
                          ? "border-primary/60 bg-primary/12 shadow-sm"
                          : "border-border bg-background/50 hover:border-border-strong hover:bg-card-elevated/70"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-mono text-[10px] font-bold ${
                              tool.method === "GET"
                                ? "text-positive"
                                : "text-link"
                            }`}
                          >
                            {tool.method}
                          </span>
                          <span className="truncate text-xs font-semibold text-foreground">
                            {tool.label}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                          {tool.name}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9.5px] font-medium ${schemaTag.toneClass}`}
                      >
                        {schemaTag.badge}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Selected Tool Explanation & Endpoint */}
              <div className="space-y-2 rounded-[12px] border border-border bg-background/50 p-3">
                <p className="text-xs leading-relaxed text-foreground">
                  {currentToolMeta.summary}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {currentToolMeta.routingNote}
                </p>
                <p className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-border bg-card px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground">
                  <span
                    className={`shrink-0 font-bold ${
                      currentToolMeta.method === "GET"
                        ? "text-positive"
                        : "text-link"
                    }`}
                  >
                    {currentToolMeta.method}
                  </span>
                  <span className="truncate">{currentToolMeta.restPath}</span>
                </p>
              </div>
            </div>

            {/* Dynamic Tool Parameters */}
            <div className="space-y-3.5 border-t border-border pt-4">
              <div>
                <label
                  htmlFor="quote-currency"
                  className="block font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  Quote Currency
                </label>
                <input
                  id="quote-currency"
                  type="text"
                  value={quoteCurrency}
                  onChange={(e) => setQuoteCurrency(e.target.value)}
                  placeholder="USD"
                  className={INPUT_CLASS}
                />
              </div>

              {(selectedTool === "compare_assets" ||
                selectedTool === "analyze_momentum") && (
                <div>
                  <label
                    htmlFor="symbols-input"
                    className="block font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Symbols (comma-separated)
                  </label>
                  <input
                    id="symbols-input"
                    type="text"
                    value={symbolsInput}
                    onChange={(e) => setSymbolsInput(e.target.value)}
                    placeholder="SOL, AVAX, NEAR"
                    className={INPUT_CLASS}
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUICK_SYMBOL_SETS.map((presetSet) => (
                      <button
                        key={presetSet}
                        type="button"
                        onClick={() => setSymbolsInput(presetSet)}
                        className="cursor-pointer rounded-[6px] border border-border bg-background/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                      >
                        {presetSet}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(selectedTool === "analyze_asset" ||
                selectedTool === "get_historical_performance" ||
                selectedTool === "analyze_derivatives") && (
                <div>
                  <label
                    htmlFor="single-symbol"
                    className="block font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Asset Symbol
                  </label>
                  <input
                    id="single-symbol"
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="SOL"
                    className={INPUT_CLASS}
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUICK_SYMBOLS.map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => setSymbol(sym)}
                        className={`cursor-pointer rounded-[6px] border px-2 py-0.5 font-mono text-[10.5px] transition-colors ${
                          symbol.trim().toUpperCase() === sym
                            ? "border-primary/50 bg-primary/12 text-link"
                            : "border-border bg-background/60 text-muted-foreground hover:border-border-strong hover:text-foreground"
                        }`}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedTool === "get_historical_performance" && (
                <div>
                  <label
                    htmlFor="hist-count"
                    className="block font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Daily Candles (5–90)
                  </label>
                  <input
                    id="hist-count"
                    type="number"
                    min={5}
                    max={90}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
              )}

              {selectedTool === "detect_market_anomalies" && (
                <div>
                  <label
                    htmlFor="anomaly-universe"
                    className="block font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Universe Size (10–200)
                  </label>
                  <input
                    id="anomaly-universe"
                    type="number"
                    min={10}
                    max={200}
                    value={universeSize}
                    onChange={(e) => setUniverseSize(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
              )}

              {selectedTool === "scan_market_movers" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="min-mcap"
                      className="block font-mono text-[11px] text-muted-foreground"
                    >
                      Min MCap ($)
                    </label>
                    <input
                      id="min-mcap"
                      type="number"
                      value={minMarketCap}
                      onChange={(e) => setMinMarketCap(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="min-vol"
                      className="block font-mono text-[11px] text-muted-foreground"
                    >
                      Min Vol 24h ($)
                    </label>
                    <input
                      id="min-vol"
                      type="number"
                      value={minVolume24h}
                      onChange={(e) => setMinVolume24h(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="max-gain"
                      className="block font-mono text-[11px] text-muted-foreground"
                    >
                      Max 24h Gain (%)
                    </label>
                    <input
                      id="max-gain"
                      type="number"
                      step="0.5"
                      value={max24hGain}
                      onChange={(e) => setMax24hGain(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="max-7d-gain"
                      className="block font-mono text-[11px] text-muted-foreground"
                    >
                      Max 7d Gain (%)
                    </label>
                    <input
                      id="max-7d-gain"
                      type="number"
                      min={-100}
                      max={10000}
                      step="1"
                      value={max7dGain}
                      onChange={(e) => setMax7dGain(e.target.value)}
                      placeholder="optional"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="min-v2m"
                      className="block font-mono text-[11px] text-muted-foreground"
                    >
                      Min Vol/MCap
                    </label>
                    <input
                      id="min-v2m"
                      type="number"
                      step="0.01"
                      value={minVolToMcap}
                      onChange={(e) => setMinVolToMcap(e.target.value)}
                      placeholder="optional"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="min-rs"
                      className="block font-mono text-[11px] text-muted-foreground"
                    >
                      Min RS BTC 7d
                    </label>
                    <input
                      id="min-rs"
                      type="number"
                      step="0.5"
                      value={minRs7d}
                      onChange={(e) => setMinRs7d(e.target.value)}
                      placeholder="optional"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="mover-limit"
                      className="block font-mono text-[11px] text-muted-foreground"
                    >
                      Limit (1–50)
                    </label>
                    <input
                      id="mover-limit"
                      type="number"
                      min={1}
                      max={50}
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="col-span-2">
                    <label
                      htmlFor="rank-by"
                      className="block font-mono text-[11px] text-muted-foreground"
                    >
                      Rank By
                    </label>
                    <select
                      id="rank-by"
                      value={rankBy}
                      onChange={(e) => setRankBy(e.target.value as RankBy)}
                      className={`${INPUT_CLASS} cursor-pointer`}
                    >
                      <option value="composite_momentum_score">
                        composite_momentum_score
                      </option>
                      <option value="rs_vs_btc_7d">rs_vs_btc_7d</option>
                      <option value="volume_to_mcap">volume_to_mcap</option>
                    </select>
                  </div>
                </div>
              )}

              {selectedTool === "analyze_sector_rotation" && (
                <fieldset className="space-y-2">
                  <legend className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    Sectors ({selectedSectors.length} selected)
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {SECTOR_OPTIONS.map((sec) => {
                      const checked = selectedSectors.includes(sec.slug);
                      return (
                        <button
                          key={sec.slug}
                          type="button"
                          onClick={() => toggleSector(sec.slug)}
                          className={`cursor-pointer rounded-full border px-3 py-1 font-mono text-[11px] font-medium transition-colors duration-150 ${
                            checked
                              ? sec.highlighted
                                ? "border-accent bg-accent text-accent-foreground"
                                : "border-primary bg-primary/15 text-primary"
                              : "border-border bg-background/60 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {sec.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </div>

            <button
              type="submit"
              disabled={running}
              className="tg-btn tg-btn-primary ct-btn-glow flex min-h-11 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t.playground.executing} {selectedTool}...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {t.playground.runTool} {selectedTool}
                </>
              )}
            </button>
          </form>

          {/* Collapsible BYOK Key Drawer */}
          <div className="tg-panel overflow-hidden rounded-2xl">
            <button
              type="button"
              onClick={() => setByokOpen((open) => !open)}
              aria-expanded={byokOpen}
              className="flex w-full cursor-pointer items-center justify-between px-5 py-3.5 text-left transition-colors duration-200 hover:bg-card-elevated/60"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <KeyRound
                  className="h-4 w-4 text-primary"
                  aria-hidden="true"
                />
                {t.playground.byokTitle}
                {byokKey && (
                  <span className="rounded-full bg-positive/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-positive">
                    {t.playground.byokInMemory}
                  </span>
                )}
              </span>
              {byokOpen ? (
                <ChevronUp
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </button>

            {byokOpen && (
              <div className="space-y-3 border-t border-border p-5">
                <label
                  htmlFor="byok-key"
                  className="block font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  {t.playground.byokLabel}
                </label>
                <div className="flex gap-2">
                  <input
                    id="byok-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={byokKey}
                    onChange={(e) => setByokKey(e.target.value)}
                    placeholder={t.playground.byokPlaceholder}
                    className="min-w-0 flex-1 rounded-xl border border-border bg-card-elevated px-3 py-2 font-mono text-xs text-foreground"
                  />
                  {byokKey && (
                    <button
                      type="button"
                      onClick={() => setByokKey("")}
                      aria-label="Clear BYOK key from memory"
                      className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-card-elevated px-3 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t.playground.byokHint}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Right Output Studio */}
        <section
          aria-labelledby="output-heading"
          className="space-y-4 lg:col-span-8"
        >
          {/* Output Studio Header: Tabs + Sample/Live Toggle + Status */}
          <div className="ct-surface-featured flex flex-wrap items-center justify-between gap-3 rounded-[16px] px-4 py-3">
            <div
              role="tablist"
              aria-label="Playground output views"
              className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-border bg-background/70 p-1"
            >
              {(
                [
                  { id: "report", label: t.playground.tabReport },
                  { id: "json", label: t.playground.tabJson },
                  { id: "evidence", label: t.playground.tabEvidence },
                  {
                    id: "request",
                    label: locale === "id" ? "Kode Request" : "Request Code",
                  },
                ] as const
              ).map((tab) => {
                const active = outputTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setOutputTab(tab.id)}
                    className={`cursor-pointer whitespace-nowrap rounded-[7px] px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Source Mode Switcher: Sample Schema vs Live Result */}
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label={
                  locale === "id" ? "Sumber preview output" : "Output source mode"
                }
                className="inline-flex items-center rounded-[10px] border border-border bg-background/70 p-1 font-mono text-[11px]"
              >
                <button
                  type="button"
                  onClick={() => setOutputSource("sample")}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 py-1 transition-colors ${
                    !showingLive
                      ? "bg-accent/20 font-semibold text-accent"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  <span>{locale === "id" ? "Contoh Skema" : "Sample Schema"}</span>
                </button>
                {outcome !== null && (
                  <button
                    type="button"
                    onClick={() => setOutputSource("live")}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 py-1 transition-colors ${
                      showingLive
                        ? "bg-positive/20 font-semibold text-positive"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Terminal className="h-3 w-3" aria-hidden="true" />
                    <span>{locale === "id" ? "Hasil Live" : "Live Result"}</span>
                  </button>
                )}
              </div>

              <div
                id="output-heading"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="font-mono text-xs text-muted-foreground"
              >
                {running ? (
                  <span className="inline-flex items-center gap-1.5 text-link">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t.common.running}
                  </span>
                ) : showingLive ? (
                  <span>
                    <strong className="text-foreground">{outcome.label}</strong> ·{" "}
                    {formatDurationMs(outcome.latencyMs)}
                  </span>
                ) : (
                  <span className="text-accent">
                    {locale === "id" ? "Sampel skema" : "Schema preview"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Session Run History Bar */}
          {runHistory.length > 0 && (
            <div className="ct-surface-card flex flex-wrap items-center gap-2 rounded-[12px] px-3.5 py-2.5">
              <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-subtle-foreground">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                {locale === "id" ? "Riwayat Sesi:" : "Session Runs:"}
              </span>
              {runHistory.map((item) => {
                const isSelected = showingLive && outcome?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setOutcome(item);
                      setOutputSource("live");
                      setSelectedTool(item.tool);
                    }}
                    className={`cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
                      isSelected
                        ? "border-positive/60 bg-positive/15 font-semibold text-positive"
                        : "border-border bg-background/60 text-muted-foreground hover:border-border-strong hover:text-foreground"
                    }`}
                  >
                    {item.label} · {formatDurationMs(item.latencyMs)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Request Code View (cURL / MCP / Python) */}
          {outputTab === "request" && (
            <div className="ct-code-swap space-y-4">
              <div className="ct-surface-featured overflow-hidden rounded-[16px]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[#080B12] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Code2 className="h-3.5 w-3.5 text-link" aria-hidden="true" />
                    <div
                      role="tablist"
                      aria-label="Request snippet language"
                      className="inline-flex items-center gap-1"
                    >
                      {(
                        [
                          { id: "curl", label: "REST cURL" },
                          { id: "mcp", label: "MCP JSON-RPC" },
                          { id: "python", label: "Python httpx" },
                        ] as const
                      ).map((lang) => (
                        <button
                          key={lang.id}
                          type="button"
                          role="tab"
                          aria-selected={snippetLang === lang.id}
                          onClick={() => setSnippetLang(lang.id)}
                          className={`cursor-pointer rounded-[6px] px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                            snippetLang === lang.id
                              ? "bg-primary/20 text-link"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <CopyButton
                    text={snippetContent}
                    label={locale === "id" ? "Salin" : "Copy"}
                  />
                </div>
                <pre className="overflow-x-auto bg-code-bg p-4 font-mono text-xs leading-6 text-foreground">
                  <code>{snippetContent}</code>
                </pre>
              </div>

              <div className="ct-surface-card rounded-[14px] p-4 font-mono text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">MCP Endpoint:</span>{" "}
                {mcpEndpoint} ·{" "}
                <span className="font-semibold text-foreground">REST Base:</span>{" "}
                {apiBase}
              </div>
            </div>
          )}

          {/* Running State */}
          {outputTab !== "request" && running && (
            <div className="ct-surface-featured overflow-hidden rounded-[16px]">
              <div className="h-[2px] w-full overflow-hidden bg-border/40">
                <div className="ct-progress-bar h-full w-2/5 rounded-full bg-primary" />
              </div>
              <div className="space-y-3 p-6 font-mono text-xs text-muted-foreground">
                <div className="flex items-center gap-2 text-link">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{t.playground.runningBanner}</span>
                </div>
                <div className="space-y-2 pt-1">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-muted/60" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted/30" />
                </div>
              </div>
            </div>
          )}

          {/* Live Error Notice */}
          {outputTab !== "request" &&
            !running &&
            showingLive &&
            outcome?.error && (
              <ApiNotice
                status={outcome.error.status}
                message={outcome.error.message}
                retryAfterSeconds={outcome.error.retryAfterSeconds}
              />
            )}

          {/* Active Envelopes (Sample Schema OR Live Result) */}
          {outputTab !== "request" && !running && activeEnvelopes.length > 0 && (
            <div className="ct-code-swap space-y-4">
              {!showingLive && (
                <div className="flex flex-col justify-between gap-3 rounded-[14px] border border-accent/40 bg-accent/10 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-2.5">
                    <Info
                      className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-accent">
                        {locale === "id"
                          ? "Contoh Skema Ilustratif · Bukan Data Live"
                          : "Illustrative Schema Example · Not Live Data"}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-foreground">
                        {locale === "id"
                          ? "Ini adalah bentuk struktur respons asli EvidenceEnvelope[T] (lengkap dengan grafik, nilai null jujur, dan provenance audit). Klik Run untuk mengambil data real-time."
                          : "Previewing the real EvidenceEnvelope[T] structure (interactive charts, honest null-safety, and audit provenance). Click Run to query live market ticks."}
                      </p>
                    </div>
                  </div>
                  {isSignedIn ? (
                    <button
                      type="button"
                      onClick={() => {
                        const params = buildParamsForTool(selectedTool);
                        void executeSingleTool(
                          selectedTool,
                          params,
                          currentToolMeta.label,
                        );
                      }}
                      className="tg-btn tg-btn-primary inline-flex shrink-0 cursor-pointer text-xs"
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{locale === "id" ? "Jalankan Live" : "Run Live"}</span>
                    </button>
                  ) : (
                    <Link
                      href="/login?next=/playground"
                      className="tg-btn tg-btn-secondary inline-flex shrink-0 text-xs"
                    >
                      {locale === "id" ? "Masuk untuk Live" : "Sign in for Live"}
                    </Link>
                  )}
                </div>
              )}

              {outputTab === "report" &&
                activeEnvelopes.map((env) => (
                  <EnvelopeFormattedReport
                    key={`${showingLive ? "live" : "sample"}-${env.evidence.evidence_id}`}
                    envelope={env}
                  />
                ))}

              {outputTab === "json" && (
                <JsonViewer
                  title={
                    activeEnvelopes.length === 1
                      ? `${activeEnvelopes[0].tool} · ${showingLive ? "Live" : "Sample"} EvidenceEnvelope`
                      : `${activePreset?.title ?? outcome?.label ?? "Preset"} · ${activeEnvelopes.length} Envelopes`
                  }
                  value={
                    activeEnvelopes.length === 1
                      ? activeEnvelopes[0]
                      : activeEnvelopes
                  }
                />
              )}

              {outputTab === "evidence" &&
                activeEnvelopes.map((env) => (
                  <EnvelopeEvidenceView
                    key={`${showingLive ? "live" : "sample"}-ev-${env.evidence.evidence_id}`}
                    envelope={env}
                  />
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
