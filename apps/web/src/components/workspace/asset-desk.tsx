"use client";

import { BarChart3, GitCompareArrows, Play, RefreshCw, TrendingUp } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiNotice } from "@/components/api-notice";
import { useAppPreferences } from "@/components/app-preferences";
import {
  Button,
  DeskSkeleton,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import { runIntelligenceTool } from "@/lib/api";
import { symbolList, validateToolInput } from "@/lib/tool-input";
import type { EvidenceEnvelope, ToolName } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { ResultStack } from "./result-stack";

const QUICK_ASSETS = ["BTC", "ETH", "SOL", "AVAX", "LINK", "ONDO", "NEAR", "UNI"] as const;
const QUICK_QUOTES = ["USD", "EUR", "BTC"] as const;

const INPUT =
  "mt-1.5 min-h-11 sm:min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

export function AssetDesk() {
  const { locale } = useAppPreferences();
  const searchParams = useSearchParams();
  const querySymbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";

  const copy = workspaceCopy(locale);
  const [symbol, setSymbol] = useState(querySymbol || "BTC");
  const [peers, setPeers] = useState("ETH, SOL");
  const [quote, setQuote] = useState("USD");
  const [running, setRunning] = useState<ToolName | null>(null);
  const [lastTool, setLastTool] = useState<ToolName>("analyze_asset");
  const [error, setError] = useState<{
    status: number;
    message: string;
    retryAfterSeconds?: number;
  } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [envelopes, setEnvelopes] = useState<EvidenceEnvelope[]>([]);
  const autoStartedForRef = useRef<string | null>(null);

  async function run(tool: ToolName, overrideSymbol?: string, overrideQuote?: string) {
    const activeSym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const quoteCurrency = (overrideQuote ?? quote).trim().toUpperCase() || "USD";
    const params =
      tool === "analyze_asset"
        ? { quote_currency: quoteCurrency, symbol: activeSym }
        : {
            quote_currency: quoteCurrency,
            symbols: symbolList(
              tool === "analyze_momentum" && !peers.trim()
                ? activeSym
                : `${activeSym}, ${peers}`,
            ),
          };
    const invalid = validateToolInput(tool, params);
    if (invalid) {
      setValidation(invalid);
      return;
    }
    setValidation(null);
    setLastTool(tool);
    setRunning(tool);
    setError(null);
    const result = await runIntelligenceTool(tool, params);
    setRunning(null);
    if (!result.ok) {
      setError({
        status: result.status,
        message: result.message,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      return;
    }
    setEnvelopes([result.data]);
  }

  useEffect(() => {
    const target = querySymbol || "BTC";
    if (autoStartedForRef.current === target) return;
    autoStartedForRef.current = target;
    const timer = window.setTimeout(() => {
      setSymbol(target);
      void run("analyze_asset", target);
    }, 0);
    return () => window.clearTimeout(timer);
    // Run initial asset profile automatically on mount or ?symbol= navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySymbol]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].assets}
        description={copy.assetsBody}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
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
                    disabled={running !== null}
                    onClick={() => {
                      setQuote(q);
                      if (running === null) void run(lastTool, undefined, q);
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

            <Button
              type="button"
              variant="primary"
              size="md"
              loading={running !== null}
              onClick={() => void run(lastTool)}
              className="ct-btn-glow"
            >
              {running === null ? <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <span>{running !== null ? copy.running : copy.refresh}</span>
            </Button>
          </div>
        }
      />

      <div className="ct-surface-featured space-y-4 rounded-[16px] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Pilih Koin" : "Select Coin"}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_ASSETS.map((ticker) => {
              const active = symbol.trim().toUpperCase() === ticker;
              return (
                <button
                  key={ticker}
                  type="button"
                  onClick={() => {
                    setSymbol(ticker);
                    if (running === null) void run("analyze_asset", ticker);
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
        </div>

        <form
          className="grid gap-3.5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!running) void run("analyze_asset");
          }}
        >
          <label className="text-xs font-medium text-muted-foreground">
            {locale === "id" ? "Koin Utama" : "Primary Coin"}
            <input
              className={INPUT}
              value={symbol}
              placeholder="BTC"
              onChange={(event) => setSymbol(event.target.value)}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            {locale === "id" ? "Bandingkan dengan (pisahkan koma)" : "Compare With (comma-separated)"}
            <input
              className={INPUT}
              value={peers}
              placeholder="ETH, SOL"
              onChange={(event) => setPeers(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2.5 pt-1 sm:col-span-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={running === "analyze_asset"}
              disabled={running !== null}
              className="ct-btn-glow"
            >
              {running !== "analyze_asset" ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <span>{locale === "id" ? "Analisis Koin" : "Analyze Coin"}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              loading={running === "compare_assets"}
              disabled={running !== null}
              onClick={() => void run("compare_assets")}
            >
              <GitCompareArrows className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{locale === "id" ? "Bandingkan Koin" : "Compare Coins"}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              loading={running === "analyze_momentum"}
              disabled={running !== null}
              onClick={() => void run("analyze_momentum")}
            >
              <TrendingUp className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{locale === "id" ? "Cek Momentum" : "Check Momentum"}</span>
            </Button>
          </div>
        </form>
      </div>

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
          onRetry={() => void run(lastTool)}
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
          icon={<BarChart3 className="h-5 w-5 text-link" aria-hidden="true" />}
          title={locale === "id" ? "Pilih koin di atas" : "Pick a coin above"}
          description={
            locale === "id"
              ? "Klik Analisis Koin atau salah satu ticker populer untuk melihat harga, likuiditas, dan risiko."
              : "Click Analyze Coin or any popular ticker to view price, liquidity, and risk metrics."
          }
          action={
            <Button
              variant="primary"
              size="md"
              onClick={() => void run("analyze_asset")}
              className="ct-btn-glow"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {locale === "id"
                  ? `Analisis ${symbol.trim().toUpperCase() || "BTC"}`
                  : `Analyze ${symbol.trim().toUpperCase() || "BTC"}`}
              </span>
            </Button>
          }
        />
      ) : null}

      <ResultStack envelopes={envelopes} />
    </div>
  );
}
