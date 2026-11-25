"use client";

import { Check, Copy, Play, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { TOOL_CATALOG } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import type { ToolName } from "@/lib/types";

type ConsoleTab = "mcp" | "rest" | "envelope";
type FlowPhase = "sending" | "computing" | "ready";

const FEATURED_TOOLS: ToolName[] = [
  "analyze_market_regime",
  "get_market_overview",
  "scan_market_movers",
];

interface ResponseField {
  key: string;
  value: string;
  tone?: "positive" | "link" | "warning" | "muted";
}

const TOOL_SCHEMA_PREVIEW: Partial<Record<ToolName, ResponseField[]>> = {
  analyze_market_regime: [
    { key: "status", value: '"OK"', tone: "positive" },
    { key: "data.regime", value: '"RISK_ON | NEUTRAL | RISK_OFF"', tone: "link" },
    { key: "methodology.annualization_basis", value: '"365d"', tone: "muted" },
    { key: "evidence.data_mode", value: '"LIVE | CACHED"', tone: "warning" },
    { key: "limitations", value: "[]", tone: "muted" },
  ],
  get_market_overview: [
    { key: "status", value: '"OK"', tone: "positive" },
    { key: "data.breadth_top_50", value: '"computed | null"', tone: "link" },
    { key: "methodology.annualization_basis", value: '"365d"', tone: "muted" },
    { key: "evidence.freshness", value: '"FRESH | AGING"', tone: "warning" },
    { key: "limitations", value: "[]", tone: "muted" },
  ],
  scan_market_movers: [
    { key: "status", value: '"OK | PARTIAL"', tone: "positive" },
    { key: "data.anti_chase_filter", value: '"liquidity + RS vs BTC"', tone: "link" },
    { key: "methodology.annualization_basis", value: '"365d"', tone: "muted" },
    { key: "evidence.data_mode", value: '"LIVE | CACHED"', tone: "warning" },
    { key: "limitations", value: "[]", tone: "muted" },
  ],
};

function buildCopyText(tab: ConsoleTab, toolName: ToolName): string {
  const tool = TOOL_CATALOG.find((item) => item.name === toolName) ?? TOOL_CATALOG[0];
  if (tab === "mcp") {
    return `POST https://mcp.cointrac.xyz/mcp
Authorization: Bearer <oauth_access_token>
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "${tool.name}",
    "arguments": {}
  }
}`;
  }
  if (tab === "rest") {
    return `curl -X ${tool.method} https://api.cointrac.xyz${tool.restPath} \\
  -H "x-cointrac-key: ct_live_..." \\
  -H "Accept: application/json"`;
  }
  return `{
  "tool": "${tool.name}",
  "status": "OK",
  "methodology": { "annualization_basis": "365d" },
  "evidence": { "data_mode": "LIVE", "freshness": "FRESH" },
  "limitations": []
}`;
}

export function HeroConsole({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<ConsoleTab>("mcp");
  const [selectedTool, setSelectedTool] = useState<ToolName>("analyze_market_regime");
  const [phase, setPhase] = useState<FlowPhase>("sending");
  const [runId, setRunId] = useState(0);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("computing"), 420);
    const t2 = setTimeout(() => setPhase("ready"), 880);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [selectedTool, tab, runId]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setPhase("sending");
      setSelectedTool((prev) => {
        const idx = FEATURED_TOOLS.indexOf(prev);
        return FEATURED_TOOLS[(idx + 1) % FEATURED_TOOLS.length];
      });
    }, 5200);
    return () => clearInterval(id);
  }, [paused]);

  const activeTool = TOOL_CATALOG.find((item) => item.name === selectedTool) ?? TOOL_CATALOG[0];
  const fields: ResponseField[] =
    TOOL_SCHEMA_PREVIEW[selectedTool] ?? TOOL_SCHEMA_PREVIEW.analyze_market_regime ?? [];
  const copyText = buildCopyText(tab, selectedTool);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const phaseLabel =
    phase === "sending"
      ? locale === "id"
        ? "Mengirim request..."
        : "Dispatching..."
      : phase === "computing"
        ? locale === "id"
          ? "Menghitung 365d..."
          : "Computing 365d..."
        : "200 OK · Envelope";

  const progressWidth =
    phase === "sending" ? "w-1/3" : phase === "computing" ? "w-2/3" : "w-full";

  return (
    <figure
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="ct-surface-featured ct-enter-delay-2 relative w-full min-w-0 overflow-hidden rounded-[18px]"
    >
      {/* Window Header + Fixed-Width Status Pill */}
      <div className="flex h-12 items-center justify-between gap-3 border-b border-border bg-[#080B12] px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-link" aria-hidden="true" />
          <span className="truncate font-mono text-[11px] font-medium text-[#A6B1C2]">
            {tab === "mcp" ? "mcp.cointrac.xyz/mcp" : "api.cointrac.xyz"}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`inline-flex h-6 min-w-[156px] items-center justify-center gap-1.5 rounded-full border px-2.5 font-mono text-[10.5px] font-medium transition-all duration-300 ${
              phase === "ready"
                ? "border-positive/35 bg-positive-soft text-positive"
                : "border-primary/40 bg-primary/12 text-[#75A8FF]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300 ${
                phase === "ready" ? "bg-positive" : "animate-pulse bg-[#75A8FF]"
              }`}
              aria-hidden="true"
            />
            <span className="truncate">{phaseLabel}</span>
          </span>

          <button
            type="button"
            onClick={() => {
              setPaused(true);
              setPhase("sending");
              setRunId((n) => n + 1);
            }}
            aria-label={locale === "id" ? "Putar ulang animasi request" : "Replay request"}
            title={locale === "id" ? "Jalankan ulang" : "Replay"}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] border border-[#202A3A] bg-[#0D111B] text-[#A6B1C2] transition-colors hover:border-[#2C3A50] hover:text-white"
          >
            <Play className="h-3 w-3" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label={locale === "id" ? "Salin contoh" : "Copy snippet"}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] border border-[#202A3A] bg-[#0D111B] text-[#A6B1C2] transition-colors hover:border-[#2C3A50] hover:text-white"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mode Switcher + 3-Step Pipeline Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card-elevated/40 px-4 py-2.5">
        <div
          role="tablist"
          aria-label={locale === "id" ? "Mode protokol" : "Protocol mode"}
          className="inline-flex rounded-[9px] border border-border bg-background/70 p-0.5"
        >
          {(
            [
              { id: "mcp", label: "MCP Call" },
              { id: "rest", label: "REST API" },
              { id: "envelope", label: "Envelope" },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setPaused(true);
                  setPhase("sending");
                  setTab(item.id);
                }}
                className={`cursor-pointer rounded-[7px] px-2.5 py-1 font-mono text-[11px] font-medium transition-all duration-200 ${
                  active
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
          <span
            className={`transition-colors duration-300 ${
              phase === "sending" ? "font-semibold text-link" : "text-subtle-foreground"
            }`}
          >
            1. Request
          </span>
          <span className="text-border-strong">→</span>
          <span
            className={`transition-colors duration-300 ${
              phase === "computing" ? "font-semibold text-link" : "text-subtle-foreground"
            }`}
          >
            2. Python
          </span>
          <span className="text-border-strong">→</span>
          <span
            className={`transition-colors duration-300 ${
              phase === "ready" ? "font-semibold text-positive" : "text-subtle-foreground"
            }`}
          >
            3. Envelope
          </span>
        </div>
      </div>

      {/* Tool Selector Pills */}
      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
        {FEATURED_TOOLS.map((name) => {
          const active = selectedTool === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => {
                setPaused(true);
                setPhase("sending");
                setSelectedTool(name);
              }}
              className={`cursor-pointer rounded-[7px] border px-2.5 py-1 font-mono text-[11px] transition-all duration-200 ${
                active
                  ? "border-primary/50 bg-primary/12 text-link"
                  : "border-border bg-background/40 text-muted-foreground hover:border-border-strong hover:text-foreground"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Smooth Determinate Progress Bar */}
      <div className="h-[2px] w-full overflow-hidden bg-border/40">
        <div
          className={`h-full transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${progressWidth} ${
            phase === "ready" ? "bg-positive/70" : "bg-primary"
          }`}
        />
      </div>

      {/* Fixed-Height Request & Response Stage (Zero Layout Shift) */}
      <div className="bg-code-bg p-4 font-mono text-[12px] leading-[1.6]">
        {/* Fixed-Height Outgoing Request Box */}
        <div
          key={`req-${tab}-${selectedTool}-${runId}`}
          className="ct-code-swap flex h-[62px] flex-col justify-center rounded-[10px] border border-border/80 bg-background/60 px-3.5"
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-subtle-foreground">
              {tab === "mcp" ? "tools/call" : tab === "rest" ? activeTool.method : "schema"}
            </span>
            <span className="truncate text-link">
              {tab === "mcp"
                ? selectedTool
                : tab === "rest"
                  ? activeTool.restPath
                  : `EvidenceEnvelope<${selectedTool}>`}
            </span>
          </div>
          <p className="mt-1 truncate text-[11.5px] text-muted-foreground">
            {tab === "mcp"
              ? `{"jsonrpc":"2.0","method":"tools/call","params":{"name":"${selectedTool}"}}`
              : tab === "rest"
                ? `curl -X ${activeTool.method} https://api.cointrac.xyz${activeTool.restPath} -H "x-cointrac-key: ..."`
                : `// Standard EvidenceEnvelope[T] returned across REST and MCP`}
          </p>
        </div>

        {/* Fixed-Height Response Stage with Smooth Crossfade */}
        <div className="relative mt-3 h-[196px] overflow-hidden rounded-[10px] border border-border/80 bg-[#080B12]/75 px-3.5 py-3">
          {/* Loading / Computing Overlay */}
          <div
            aria-hidden={phase === "ready"}
            className={`absolute inset-0 flex flex-col justify-center gap-3 px-4 transition-all duration-300 ease-out ${
              phase === "ready"
                ? "pointer-events-none translate-y-1 opacity-0"
                : "translate-y-0 opacity-100"
            }`}
          >
            <div className="flex items-center gap-2 text-[11px] text-link">
              <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
              <span>
                {phase === "sending"
                  ? locale === "id"
                    ? "Menghubungi endpoint CoinTrac..."
                    : "Calling CoinTrac endpoint..."
                  : locale === "id"
                    ? "Menjalankan kalkulasi Python 365d..."
                    : "Running Python 365d calculations..."}
              </span>
            </div>
            <div className="space-y-2.5">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted/60" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted/45" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted/35" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted/25" />
            </div>
          </div>

          {/* Staggered JSON Envelope Reveal */}
          <div
            key={`res-${selectedTool}-${runId}`}
            className={`space-y-1 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              phase === "ready"
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-2 opacity-0"
            }`}
          >
            <p className="text-subtle-foreground">{"{"}</p>
            {fields.map((field, idx) => {
              const stagger =
                phase !== "ready"
                  ? ""
                  : idx === 0
                    ? "ct-stagger-1"
                    : idx === 1
                      ? "ct-stagger-2"
                      : idx === 2
                        ? "ct-stagger-3"
                        : "ct-stagger-4";
              const valClass =
                field.tone === "positive"
                  ? "text-positive"
                  : field.tone === "link"
                    ? "text-[#75A8FF]"
                    : field.tone === "warning"
                      ? "text-warning"
                      : "text-muted-foreground";
              return (
                <p key={field.key} className={`${stagger} truncate pl-3 text-[11.5px]`}>
                  <span className="text-[#A6B1C2]">&quot;{field.key}&quot;</span>
                  <span className="text-subtle-foreground">: </span>
                  <span className={valClass}>{field.value}</span>
                  {idx < fields.length - 1 ? (
                    <span className="text-subtle-foreground">,</span>
                  ) : null}
                </p>
              );
            })}
            <p className="text-subtle-foreground">{"}"}</p>
          </div>
        </div>
      </div>

      {/* Fixed-Height Footer Caption */}
      <figcaption className="flex h-11 items-center justify-between gap-3 border-t border-border bg-card-elevated/40 px-4 text-[11.5px] text-subtle-foreground">
        <span className="truncate">{activeTool.summary}</span>
        <span className="shrink-0 font-mono text-[11px] text-link">
          {locale === "id" ? "kosong tetap null · 365d" : "missing stays null · 365d"}
        </span>
      </figcaption>
    </figure>
  );
}
