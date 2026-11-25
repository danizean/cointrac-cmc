"use client";

import { Activity, Play, RefreshCw } from "lucide-react";
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
import { validateToolInput } from "@/lib/tool-input";
import type { EvidenceEnvelope } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { ResultStack } from "./result-stack";

const QUICK_COINS = ["BTC", "ETH", "SOL", "AVAX", "LINK", "XRP", "DOGE", "BNB"] as const;
const QUICK_QUOTES = ["USD", "EUR", "BTC"] as const;

const INPUT =
  "mt-1.5 min-h-11 sm:min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

export function DerivativesDesk() {
  const { locale } = useAppPreferences();
  const searchParams = useSearchParams();
  const querySymbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const copy = workspaceCopy(locale);

  const [symbol, setSymbol] = useState(querySymbol || "BTC");
  const [quote, setQuote] = useState("USD");
  const [running, setRunning] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<{
    status: number;
    message: string;
    retryAfterSeconds?: number;
  } | null>(null);
  const [envelopes, setEnvelopes] = useState<EvidenceEnvelope[]>([]);
  const autoStartedForRef = useRef<string | null>(null);

  async function run(overrideSymbol?: string, overrideQuote?: string) {
    const activeSym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const quoteCurrency = (overrideQuote ?? quote).trim().toUpperCase() || "USD";
    const params = { quote_currency: quoteCurrency, symbol: activeSym };

    const invalid = validateToolInput("analyze_derivatives", params);
    if (invalid) {
      setValidation(
        locale === "id" ? "Masukkan simbol koin yang valid (mis. BTC)." : invalid,
      );
      return;
    }

    setValidation(null);
    setRunning(true);
    setError(null);

    const result = await runIntelligenceTool("analyze_derivatives", params);
    setRunning(false);
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
      void run(target);
    }, 0);
    return () => window.clearTimeout(timer);
    // Run initial derivatives check automatically on mount or ?symbol= navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySymbol]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].derivatives}
        description={copy.derivativesBody}
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

      <div className="ct-surface-featured space-y-4 rounded-[16px] p-4 sm:p-5">
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
                    setSymbol(ticker);
                    if (!running) void run(ticker);
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
          className="grid gap-3.5 sm:grid-cols-[1fr_auto]"
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
              placeholder="BTC"
              onChange={(event) => setSymbol(event.target.value)}
            />
          </label>

          <div className="flex items-end">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={running}
              className="w-full sm:w-auto"
            >
              {!running ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <span>{locale === "id" ? "Cek Derivatif" : "Check Derivatives"}</span>
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
          icon={<Activity className="h-5 w-5 text-link" aria-hidden="true" />}
          title={locale === "id" ? "Siap memeriksa data derivatif" : "Ready to inspect derivatives"}
          description={
            locale === "id"
              ? "Pilih koin di atas untuk melihat open interest, funding rate, dan sinyal tekanan pasar."
              : "Pick a coin above to inspect open interest, funding rates, and market stress."
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
