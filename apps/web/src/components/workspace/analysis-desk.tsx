"use client";

import { useEffect, useRef, useState } from "react";
import { ApiNotice } from "@/components/api-notice";
import { useAppPreferences } from "@/components/app-preferences";
import { runIntelligenceTool } from "@/lib/api";
import { SECTOR_OPTIONS } from "@/lib/catalog";
import { symbolList, validateToolInput } from "@/lib/tool-input";
import type { EvidenceEnvelope, RankBy, SectorSlug, ToolName } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { ResultStack } from "./result-stack";

type Field = "quote" | "symbol" | "symbols" | "count" | "universe" | "movers" | "sectors";
type PageKey = "overview" | "market" | "movers" | "anomalies" | "sectors" | "derivatives" | "historical";

const INPUT =
  "mt-1.5 w-full min-w-0 rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-xs text-foreground";

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function AnalysisDesk({
  pageKey,
  tools,
  fields,
  autoRun = false,
}: {
  pageKey: PageKey;
  tools: ToolName[];
  fields: Field[];
  autoRun?: boolean;
}) {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const title = NAV_LABELS[locale][pageKey];
  const body = copy[`${pageKey}Body`];
  const [quote, setQuote] = useState("USD");
  const [symbol, setSymbol] = useState(pageKey === "historical" ? "SOL" : "BTC");
  const [symbols, setSymbols] = useState("BTC, ETH");
  const [count, setCount] = useState("30");
  const [universe, setUniverse] = useState("150");
  const [limit, setLimit] = useState("15");
  const [minCap, setMinCap] = useState("250000000");
  const [minVol, setMinVol] = useState("15000000");
  const [maxGain, setMaxGain] = useState("18");
  const [rankBy, setRankBy] = useState<RankBy>("composite_momentum_score");
  const [sectors, setSectors] = useState<SectorSlug[]>(SECTOR_OPTIONS.map((item) => item.slug));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ status: number; message: string; retryAfterSeconds?: number } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [envelopes, setEnvelopes] = useState<EvidenceEnvelope[]>([]);
  const started = useRef(false);

  function paramsFor(tool: ToolName): Record<string, unknown> {
    const base = { quote_currency: quote.trim().toUpperCase() || "USD" };
    if (tool === "scan_market_movers") {
      return {
        ...base,
        min_market_cap_usd: optionalNumber(minCap),
        min_volume_24h_usd: optionalNumber(minVol),
        max_24h_gain_pct: optionalNumber(maxGain),
        rank_by: rankBy,
        limit: optionalNumber(limit) ?? 15,
        universe_size: optionalNumber(universe) ?? 150,
      };
    }
    if (tool === "detect_market_anomalies") {
      return { ...base, universe_size: optionalNumber(universe) ?? 150 };
    }
    if (tool === "analyze_sector_rotation") {
      return { ...base, sectors };
    }
    if (tool === "get_historical_performance") {
      return { ...base, symbol: symbol.trim().toUpperCase(), count: optionalNumber(count) ?? 30 };
    }
    if (tool === "analyze_asset" || tool === "analyze_derivatives") {
      return { ...base, symbol: symbol.trim().toUpperCase() };
    }
    if (tool === "compare_assets" || tool === "analyze_momentum") {
      return { ...base, symbols: symbolList(symbols) };
    }
    return base;
  }

  async function run() {
    const invalid = tools.map((tool) => validateToolInput(tool, paramsFor(tool))).find(Boolean) ?? null;
    if (invalid) {
      setValidation(invalid);
      return;
    }
    setValidation(null);
    setRunning(true);
    setError(null);
    const results = await Promise.all(tools.map((tool) => runIntelligenceTool(tool, paramsFor(tool))));
    setRunning(false);
    const next = results.flatMap((result) => (result.ok ? [result.data] : []));
    const failed = results.find((result) => !result.ok);
    setEnvelopes(next);
    setError(failed && !failed.ok ? { status: failed.status, message: failed.message, retryAfterSeconds: failed.retryAfterSeconds } : null);
  }

  useEffect(() => {
    if (!autoRun || started.current) return;
    started.current = true;
    const timer = window.setTimeout(() => {
      void run();
    }, 0);
    return () => window.clearTimeout(timer);
    // The snapshot should run once when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.limitations}</p>
      </header>
      <form
        className="grid gap-3 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!running) void run();
        }}
      >
        {fields.includes("quote") ? (
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Quote
            <input className={INPUT} value={quote} onChange={(event) => setQuote(event.target.value)} />
          </label>
        ) : null}
        {fields.includes("symbol") ? (
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Symbol
            <input className={INPUT} value={symbol} onChange={(event) => setSymbol(event.target.value)} />
          </label>
        ) : null}
        {fields.includes("symbols") ? (
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
            Symbols
            <input className={INPUT} value={symbols} onChange={(event) => setSymbols(event.target.value)} />
          </label>
        ) : null}
        {fields.includes("count") ? (
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Daily candles
            <input className={INPUT} inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value)} />
          </label>
        ) : null}
        {fields.includes("universe") || fields.includes("movers") ? (
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Universe
            <input className={INPUT} inputMode="numeric" value={universe} onChange={(event) => setUniverse(event.target.value)} />
          </label>
        ) : null}
        {fields.includes("movers") ? (
          <>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Min market cap
              <input className={INPUT} inputMode="numeric" value={minCap} onChange={(event) => setMinCap(event.target.value)} />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Min 24h volume
              <input className={INPUT} inputMode="numeric" value={minVol} onChange={(event) => setMinVol(event.target.value)} />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Max 24h gain %
              <input className={INPUT} inputMode="decimal" value={maxGain} onChange={(event) => setMaxGain(event.target.value)} />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Limit
              <input className={INPUT} inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value)} />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Rank by
              <select className={INPUT} value={rankBy} onChange={(event) => setRankBy(event.target.value as RankBy)}>
                <option value="composite_momentum_score">composite_momentum_score</option>
                <option value="rs_vs_btc_7d">rs_vs_btc_7d</option>
                <option value="volume_to_mcap">volume_to_mcap</option>
              </select>
            </label>
          </>
        ) : null}
        {fields.includes("sectors") ? (
          <fieldset className="sm:col-span-2 lg:col-span-4">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sectors</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {SECTOR_OPTIONS.map((sector) => {
                const active = sectors.includes(sector.slug);
                return (
                  <button
                    key={sector.slug}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setSectors((current) =>
                        current.includes(sector.slug)
                          ? current.filter((item) => item !== sector.slug)
                          : [...current, sector.slug],
                      )
                    }
                    className={`min-h-10 rounded-[8px] border px-3 text-xs ${
                      active ? "border-primary text-foreground" : "border-border text-muted-foreground"
                    }`}
                  >
                    {sector.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        <div className="flex items-end">
          <button type="submit" disabled={running} className="tg-btn tg-btn-primary inline-flex min-h-11 disabled:opacity-60">
            {running ? copy.running : copy.run}
          </button>
        </div>
      </form>
      {validation ? (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      ) : null}
      {running ? <div className="h-28 animate-pulse rounded-xl bg-muted" aria-busy="true" /> : null}
      {error ? <ApiNotice status={error.status} message={error.message} retryAfterSeconds={error.retryAfterSeconds} /> : null}
      <ResultStack envelopes={envelopes} />
    </div>
  );
}
