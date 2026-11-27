"use client";

import { Activity, Play } from "lucide-react";
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

const QUICK_COINS = ["BTC", "ETH", "SOL", "AVAX", "LINK", "XRP", "DOGE", "BNB"] as const;

const INPUT =
  "mt-1.5 min-h-11 sm:min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

interface DerivativesCachedPayload {
  symbol: string;
  quote: string;
  envelopes: EvidenceEnvelope[];
}

export function DerivativesDesk() {
  const { locale } = useAppPreferences();
  const searchParams = useSearchParams();
  const querySymbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const copy = workspaceCopy(locale);

  const cached = useDeskCache<DerivativesCachedPayload>("derivatives:last");

  const [symbolOverride, setSymbolOverride] = useState<string | null>(querySymbol || null);
  const [quoteOverride, setQuoteOverride] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<DeskError | null>(null);
  const [liveEnvelopes, setLiveEnvelopes] = useState<EvidenceEnvelope[] | null>(null);
  const [liveCachedAt, setLiveCachedAt] = useState<number | null>(null);
  const initialized = useRef(false);

  const symbol = symbolOverride ?? cached?.value.symbol ?? "BTC";
  const quote = quoteOverride ?? cached?.value.quote ?? "USD";
  const envelopes = liveEnvelopes ?? cached?.value.envelopes ?? [];
  const cachedAt = liveCachedAt ?? cached?.cachedAt ?? null;

  const run = useCallback(
    async (overrideSymbol?: string, overrideQuote?: string) => {
      const activeSym = (overrideSymbol ?? symbol).trim().toUpperCase();
      const quoteCurrency = (overrideQuote ?? quote).trim().toUpperCase() || "USD";
      const params = { quote_currency: quoteCurrency, symbol: activeSym };

      const invalid = validateToolInput("analyze_derivatives", params);
      if (invalid) {
        setValidation(locale === "id" ? "Masukkan simbol koin yang valid (mis. BTC)." : invalid);
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

      const next = [result.data];
      setLiveEnvelopes(next);
      const ts = writeDeskCache<DerivativesCachedPayload>("derivatives:last", {
        symbol: activeSym,
        quote: quoteCurrency,
        envelopes: next,
      });
      setLiveCachedAt(ts);
    },
    [locale, quote, symbol],
  );

  useEffect(() => {
    if (initialized.current || !querySymbol) return;
    initialized.current = true;
    const prev = readDeskCache<DerivativesCachedPayload>("derivatives:last");
    if (prev && prev.value.symbol === querySymbol && prev.value.envelopes.length > 0) {
      return;
    }
    void Promise.resolve().then(() => void run(querySymbol));
  }, [querySymbol, run]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].derivatives}
        description={copy.derivativesBody}
        actions={
          <DeskHeaderActions
            quote={quote}
            running={running}
            onSelectQuote={(nextQuote) => {
              setQuoteOverride(nextQuote);
              if (!running) void run(undefined, nextQuote);
            }}
            onRefresh={() => void run()}
          />
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
                    setSymbolOverride(ticker);
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
              onChange={(event) => setSymbolOverride(event.target.value)}
            />
          </label>

          <div className="flex items-end">
            <Button type="submit" variant="primary" size="lg" loading={running} className="w-full sm:w-auto">
              {!running ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <span>{locale === "id" ? "Cek Derivatif" : "Check Derivatives"}</span>
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
        emptyIcon={<Activity className="h-5 w-5 text-link" aria-hidden="true" />}
        emptyTitle={locale === "id" ? "Siap memeriksa data derivatif" : "Ready to inspect derivatives"}
        emptyDescription={
          locale === "id"
            ? "Pilih koin di atas untuk melihat open interest, funding rate, dan sinyal tekanan pasar."
            : "Pick a coin above to inspect open interest, funding rates, and market stress."
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
