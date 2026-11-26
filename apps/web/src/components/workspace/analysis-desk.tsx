"use client";

import { LineChart, Play, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApiNotice } from "@/components/api-notice";
import { useAppPreferences } from "@/components/app-preferences";
import {
  Button,
  DeskSkeleton,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import { runIntelligenceTool } from "@/lib/api";
import { SECTOR_OPTIONS } from "@/lib/catalog";
import { symbolList, validateToolInput } from "@/lib/tool-input";
import type { EvidenceEnvelope, RankBy, SectorSlug, ToolName } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { ResultStack } from "./result-stack";
import { SnapshotFreshness } from "./snapshot-freshness";

type Field = "quote" | "symbol" | "symbols" | "count" | "universe" | "movers" | "sectors";
type PageKey =
  | "overview"
  | "market"
  | "movers"
  | "anomalies"
  | "sectors"
  | "derivatives"
  | "historical";

const QUICK_TICKERS = ["BTC", "ETH", "SOL", "AVAX", "LINK", "ONDO"] as const;
const QUICK_QUOTES = ["USD", "EUR", "BTC"] as const;
const QUICK_DAYS = ["7", "30", "90"] as const;

const INPUT =
  "mt-1.5 min-h-11 sm:min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

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
}: {
  pageKey: PageKey;
  tools: ToolName[];
  fields: Field[];
}) {
  const { locale } = useAppPreferences();
  const searchParams = useSearchParams();
  const querySymbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";

  const copy = workspaceCopy(locale);
  const title = NAV_LABELS[locale][pageKey];
  const body = copy[`${pageKey}Body`];

  const [quote, setQuote] = useState("USD");
  const [symbol, setSymbol] = useState(
    querySymbol || (pageKey === "historical" ? "SOL" : "BTC"),
  );
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
  const [error, setError] = useState<{
    status: number;
    message: string;
    retryAfterSeconds?: number;
  } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [envelopes, setEnvelopes] = useState<EvidenceEnvelope[]>([]);

  function paramsFor(tool: ToolName, overrideSymbol?: string, overrideQuote?: string): Record<string, unknown> {
    const base = { quote_currency: (overrideQuote ?? quote).trim().toUpperCase() || "USD" };
    const activeSym = (overrideSymbol ?? symbol).trim().toUpperCase();
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
      return {
        ...base,
        symbol: activeSym,
        count: optionalNumber(count) ?? 30,
      };
    }
    if (tool === "analyze_asset" || tool === "analyze_derivatives") {
      return { ...base, symbol: activeSym };
    }
    if (tool === "compare_assets" || tool === "analyze_momentum") {
      return { ...base, symbols: symbolList(symbols) };
    }
    return base;
  }

  async function run(overrideSymbol?: string, overrideQuote?: string) {
    const invalid =
      tools
        .map((tool) => validateToolInput(tool, paramsFor(tool, overrideSymbol, overrideQuote)))
        .find(Boolean) ?? null;
    if (invalid) {
      setValidation(invalid);
      return;
    }
    setValidation(null);
    setRunning(true);
    setError(null);
    const results = await Promise.all(
      tools.map((tool) =>
        runIntelligenceTool(tool, paramsFor(tool, overrideSymbol, overrideQuote)),
      ),
    );
    setRunning(false);
    const next = results.flatMap((result) => (result.ok ? [result.data] : []));
    const failed = results.find((result) => !result.ok);
    setEnvelopes(next);
    setError(
      failed && !failed.ok
        ? {
            status: failed.status,
            message: failed.message,
            retryAfterSeconds: failed.retryAfterSeconds,
          }
        : null,
    );
  }

  const quoteOnly = fields.length === 1 && fields[0] === "quote";

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={body}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {pageKey === "market" ? <SnapshotFreshness onSnapshot={() => void run()} /> : null}
            {quoteOnly ? (
              <div
                role="group"
                aria-label={locale === "id" ? "Mata uang" : "Currency"}
                className="inline-flex h-9 items-center rounded-full border border-border bg-card/80 p-0.5"
              >
                {QUICK_QUOTES.map((q) => {
                  const active = quote.trim().toUpperCase() === q;
                  return (
                    <button
                      key={q}
                      type="button"
                      disabled={running}
                      onClick={() => {
                        setQuote(q);
                        if (!running) void run(undefined, q);
                      }}
                      className={`min-h-7 cursor-pointer rounded-full px-3 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                        active
                          ? "bg-primary text-white shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {q}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={running}
              onClick={() => void run()}
              className="ct-btn-glow"
            >
              {!running ? <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <span>{running ? copy.running : copy.refresh}</span>
            </Button>
          </div>
        }
      />

      {!quoteOnly ? (
        <div className="ct-surface-featured rounded-[16px] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{locale === "id" ? "Pengaturan Analisis" : "Analysis Filters"}</span>
            </span>

            <div className="flex flex-wrap items-center gap-3">
              {fields.includes("symbol") ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] text-subtle-foreground">
                    {locale === "id" ? "Populer:" : "Popular:"}
                  </span>
                  {QUICK_TICKERS.map((ticker) => {
                    const active = symbol.trim().toUpperCase() === ticker;
                    return (
                      <button
                        key={ticker}
                        type="button"
                        onClick={() => {
                          setSymbol(ticker);
                          if (!running) void run(ticker);
                        }}
                        className={`min-h-8 cursor-pointer rounded-full border px-2.5 font-mono text-[11px] font-semibold transition-colors ${
                          active
                            ? "border-primary/50 bg-primary/14 text-link"
                            : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
                        }`}
                      >
                        {ticker}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {fields.includes("movers") ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] text-subtle-foreground">
                    {locale === "id" ? "Preset:" : "Presets:"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMinCap("250000000");
                      setMinVol("15000000");
                      setMaxGain("18");
                    }}
                    className="min-h-8 cursor-pointer rounded-full border border-border bg-background px-2.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {locale === "id" ? "Mid Cap ($250M+)" : "Mid Cap ($250M+)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMinCap("1000000000");
                      setMinVol("50000000");
                      setMaxGain("15");
                    }}
                    className="min-h-8 cursor-pointer rounded-full border border-border bg-background px-2.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {locale === "id" ? "Large Cap ($1B+)" : "Large Cap ($1B+)"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <form
            className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!running) void run();
            }}
          >
            {fields.includes("quote") ? (
              <label className="text-xs font-medium text-muted-foreground">
                {locale === "id" ? "Mata Uang" : "Currency"}
                <select
                  className={`${INPUT} cursor-pointer`}
                  value={quote}
                  onChange={(event) => setQuote(event.target.value)}
                >
                  {QUICK_QUOTES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {fields.includes("symbol") ? (
              <label className="text-xs font-medium text-muted-foreground">
                {locale === "id" ? "Simbol Koin" : "Coin Symbol"}
                <input
                  className={INPUT}
                  value={symbol}
                  placeholder="BTC"
                  onChange={(event) => setSymbol(event.target.value)}
                />
              </label>
            ) : null}
            {fields.includes("symbols") ? (
              <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
                {locale === "id" ? "Daftar Koin (pisahkan koma)" : "Coins (comma-separated)"}
                <input
                  className={INPUT}
                  value={symbols}
                  placeholder="BTC, ETH, SOL"
                  onChange={(event) => setSymbols(event.target.value)}
                />
              </label>
            ) : null}
            {fields.includes("count") ? (
              <div className="text-xs font-medium text-muted-foreground">
                <span>{locale === "id" ? "Rentang Waktu (Hari)" : "Timeframe (Days)"}</span>
                <div className="mt-1.5 flex items-center gap-1.5">
                  {QUICK_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setCount(d)}
                      className={`min-h-10 flex-1 cursor-pointer rounded-[10px] border font-mono text-xs font-semibold transition-colors ${
                        count === d
                          ? "border-primary bg-primary/14 text-link"
                          : "border-border bg-input-bg text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {fields.includes("universe") || fields.includes("movers") ? (
              <label className="text-xs font-medium text-muted-foreground">
                {locale === "id" ? "Jumlah Koin Dipindai" : "Top Coins Scanned"}
                <input
                  className={INPUT}
                  inputMode="numeric"
                  value={universe}
                  onChange={(event) => setUniverse(event.target.value)}
                />
              </label>
            ) : null}
            {fields.includes("movers") ? (
              <>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "id" ? "Kapitalisasi Min. ($)" : "Min Market Cap ($)"}
                  <input
                    className={INPUT}
                    inputMode="numeric"
                    value={minCap}
                    onChange={(event) => setMinCap(event.target.value)}
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "id" ? "Volume 24j Min. ($)" : "Min 24h Volume ($)"}
                  <input
                    className={INPUT}
                    inputMode="numeric"
                    value={minVol}
                    onChange={(event) => setMinVol(event.target.value)}
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "id" ? "Maks. Kenaikan 24j (%)" : "Max 24h Gain (%)"}
                  <input
                    className={INPUT}
                    inputMode="decimal"
                    value={maxGain}
                    onChange={(event) => setMaxGain(event.target.value)}
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  {locale === "id" ? "Jumlah Hasil" : "Max Results"}
                  <input
                    className={INPUT}
                    inputMode="numeric"
                    value={limit}
                    onChange={(event) => setLimit(event.target.value)}
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
                  {locale === "id" ? "Urutkan Berdasarkan" : "Sort By"}
                  <select
                    className={`${INPUT} cursor-pointer`}
                    value={rankBy}
                    onChange={(event) => setRankBy(event.target.value as RankBy)}
                  >
                    <option value="composite_momentum_score">
                      {locale === "id" ? "Skor Momentum Gabungan" : "Momentum Score"}
                    </option>
                    <option value="rs_vs_btc_7d">
                      {locale === "id" ? "Kekuatan Relatif vs BTC (7h)" : "Strength vs BTC (7d)"}
                    </option>
                    <option value="volume_to_mcap">
                      {locale === "id" ? "Rasio Volume / Market Cap" : "Volume / Market Cap Ratio"}
                    </option>
                  </select>
                </label>
              </>
            ) : null}
          {fields.includes("sectors") ? (
            <fieldset className="sm:col-span-2 lg:col-span-4">
              <legend className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Canonical sectors ({sectors.length} selected)
              </legend>
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
                      className={`min-h-11 sm:min-h-9 cursor-pointer rounded-[8px] border px-3 font-mono text-xs font-medium transition-colors ${
                        active
                          ? "border-primary/50 bg-primary/14 text-link"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
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
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={running}
              className="w-full sm:w-auto"
            >
              {!running ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <span>{running ? copy.running : copy.run}</span>
            </Button>
          </div>
        </form>
      </div>
      ) : null}

      {validation ? (
        <p
          role="alert"
          className="rounded-[10px] border border-destructive/40 bg-destructive-soft px-4 py-3 text-xs font-medium text-destructive"
        >
          {validation}
        </p>
      ) : null}

      {error ? (
        <ApiNotice
          status={error.status}
          message={error.message}
          retryAfterSeconds={error.retryAfterSeconds}
          onRetry={() => void run()}
        />
      ) : null}

      {running && envelopes.length === 0 ? (
        <div className="space-y-4">
          <div className="h-[2px] w-full overflow-hidden rounded-full bg-border/40">
            <div className="ct-progress-bar h-full w-2/5 rounded-full bg-primary" />
          </div>
          <DeskSkeleton />
        </div>
      ) : null}

      {!running && !error && envelopes.length === 0 ? (
        <EmptyState
          icon={<LineChart className="h-5 w-5 text-link" aria-hidden="true" />}
          title={locale === "id" ? `Siap menjalankan ${title}` : `Ready to run ${title}`}
          description={
            locale === "id"
              ? "Klik jalankan untuk mengambil data pasar terbaru. Nilai yang tidak tersedia tetap ditampilkan sebagai —."
              : "Click run to fetch the latest market data. Missing values remain —."
          }
          action={
            <Button variant="primary" size="md" onClick={() => void run()} className="ct-btn-glow">
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.run}</span>
            </Button>
          }
        />
      ) : null}

      <ResultStack envelopes={envelopes} />
    </div>
  );
}
