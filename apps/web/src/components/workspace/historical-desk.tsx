"use client";

import { LineChart, Play } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { Button, PageHeader } from "@/components/ui/primitives";
import { runIntelligenceTool } from "@/lib/api";
import { readDeskCache, useDeskCache, writeDeskCache } from "@/lib/desk-cache";
import { validateToolInput } from "@/lib/tool-input";
import type { EvidenceEnvelope } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { DeskHeaderActions, DeskResultArea, type DeskError } from "./desk-chrome";

const QUICK_COINS = ["SOL", "BTC", "ETH", "AVAX", "LINK", "ONDO", "NEAR", "UNI"] as const;
const QUICK_DAYS = [7, 30, 90, 180] as const;

const INPUT =
  "mt-1.5 min-h-11 sm:min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

interface HistoricalCachedPayload {
  symbol: string;
  quote: string;
  days: number;
  envelopes: EvidenceEnvelope[];
}

export function HistoricalDesk() {
  const { locale } = useAppPreferences();
  const searchParams = useSearchParams();
  const querySymbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const copy = workspaceCopy(locale);

  const cached = useDeskCache<HistoricalCachedPayload>("historical:last");

  const [symbolOverride, setSymbolOverride] = useState<string | null>(querySymbol || null);
  const [quoteOverride, setQuoteOverride] = useState<string | null>(null);
  const [daysOverride, setDaysOverride] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<DeskError | null>(null);
  const [liveEnvelopes, setLiveEnvelopes] = useState<EvidenceEnvelope[] | null>(null);
  const [liveCachedAt, setLiveCachedAt] = useState<number | null>(null);
  const initialized = useRef(false);

  const symbol = symbolOverride ?? cached?.value.symbol ?? "SOL";
  const quote = quoteOverride ?? cached?.value.quote ?? "USD";
  const days = daysOverride ?? cached?.value.days ?? 30;
  const envelopes = liveEnvelopes ?? cached?.value.envelopes ?? [];
  const cachedAt = liveCachedAt ?? cached?.cachedAt ?? null;

  const run = useCallback(
    async (override?: { symbol?: string; quote?: string; days?: number }) => {
      const activeSym = (override?.symbol ?? symbol).trim().toUpperCase();
      const quoteCurrency = (override?.quote ?? quote).trim().toUpperCase() || "USD";
      const count = override?.days ?? days;
      const params = {
        quote_currency: quoteCurrency,
        symbol: activeSym,
        count,
      };

      const invalid = validateToolInput("get_historical_performance", params);
      if (invalid) {
        setValidation(locale === "id" ? "Masukkan simbol koin yang valid (mis. SOL)." : invalid);
        return;
      }

      setValidation(null);
      setRunning(true);
      setError(null);

      const result = await runIntelligenceTool("get_historical_performance", params);
      setRunning(false);
      if (!result.ok) {
        setError({
          status: result.status,
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
        });
        return;
      }

      const next = [result.data];
      setLiveEnvelopes(next);
      const ts = writeDeskCache<HistoricalCachedPayload>("historical:last", {
        symbol: activeSym,
        quote: quoteCurrency,
        days: count,
        envelopes: next,
      });
      setLiveCachedAt(ts);
    },
    [days, locale, quote, symbol],
  );

  useEffect(() => {
    if (initialized.current || !querySymbol) return;
    initialized.current = true;
    const prev = readDeskCache<HistoricalCachedPayload>("historical:last");
    if (prev && prev.value.symbol === querySymbol && prev.value.envelopes.length > 0) {
      return;
    }
    void Promise.resolve().then(() => void run({ symbol: querySymbol }));
  }, [querySymbol, run]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].historical}
        description={copy.historicalBody}
        actions={
          <DeskHeaderActions
            quote={quote}
            running={running}
            onSelectQuote={(nextQuote) => {
              setQuoteOverride(nextQuote);
              if (!running) void run({ quote: nextQuote });
            }}
            onRefresh={() => void run()}
          />
        }
      />

      <div className="ct-surface-featured space-y-4 rounded-[16px] p-4 sm:p-5">
        <div className="rounded-xl border border-warning/35 bg-warning-soft/35 px-3.5 py-2.5 text-xs text-muted-foreground">
          {locale === "id"
            ? "Catatan tier sumber data: OHLCV historis penuh membutuhkan kunci CoinMarketCap dengan akses OHLCV historis (mis. via BYOK di API Keys) atau fallback snapshot terverifikasi. Tanpa akses tersebut, status kembali TIER_RESTRICTED dan metrik tetap kosong (Unavailable)."
            : "Source tier notice: Full daily OHLCV history requires a CoinMarketCap key with historical OHLCV access (e.g. BYOK in API Keys) or a verified local snapshot. Otherwise this tool returns TIER_RESTRICTED and leaves historical metrics Unavailable rather than fabricating 0."}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Pilih Koin" : "Select Coin"}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_COINS.map((ticker) => {
              const active = symbol.trim().toUpperCase() === ticker;
              return (
                <button
                  key={ticker}
                  type="button"
                  disabled={running}
                  onClick={() => {
                    setSymbolOverride(ticker);
                    if (!running) void run({ symbol: ticker });
                  }}
                  className={`min-h-8 cursor-pointer rounded-full border px-3 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 ${
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
          className="grid gap-3.5 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!running) void run();
          }}
        >
          <label className="text-xs font-medium text-muted-foreground">
            {locale === "id" ? "Simbol Koin" : "Coin Symbol"}
            <input
              className={INPUT}
              value={symbol}
              placeholder="SOL"
              onChange={(event) => setSymbolOverride(event.target.value)}
            />
          </label>

          <div className="text-xs font-medium text-muted-foreground">
            <span>{locale === "id" ? "Rentang Waktu" : "Timeframe"}</span>
            <div className="mt-1.5 flex items-center gap-1.5">
              {QUICK_DAYS.map((d) => {
                const active = days === d;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={running}
                    onClick={() => {
                      setDaysOverride(d);
                      if (!running) void run({ days: d });
                    }}
                    className={`min-h-11 sm:min-h-10 min-w-12 cursor-pointer rounded-[10px] border px-3 font-mono text-xs font-semibold transition-colors disabled:opacity-50 ${
                      active
                        ? "border-primary/55 bg-primary/14 text-link"
                        : "border-border bg-input-bg text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d}d
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-end">
            <Button type="submit" variant="primary" size="lg" loading={running} className="w-full sm:w-auto">
              {!running ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <span>{locale === "id" ? "Lihat Performa" : "Analyze History"}</span>
            </Button>
          </div>
        </form>
      </div>

      <DeskResultArea
        running={running}
        error={error}
        validation={validation}
        envelopes={envelopes}
        cachedAt={cachedAt}
        onRetry={() => void run()}
        emptyIcon={<LineChart className="h-5 w-5 text-link" aria-hidden="true" />}
        emptyTitle={locale === "id" ? "Siap melihat performa historis" : "Ready to inspect historical returns"}
        emptyDescription={
          locale === "id"
            ? "Pilih koin dan rentang waktu di atas untuk melihat volatilitas, beta, dan drawdown."
            : "Pick a coin and timeframe above to inspect volatility, beta, and max drawdown."
        }
        emptyAction={
          <Button variant="primary" size="md" onClick={() => void run()} className="ct-btn-glow">
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.run}</span>
          </Button>
        }
      />
    </div>
  );
}
