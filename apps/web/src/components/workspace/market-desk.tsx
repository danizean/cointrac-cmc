"use client";

import { LineChart, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { Button, PageHeader } from "@/components/ui/primitives";
import { runIntelligenceTool } from "@/lib/api";
import { readDeskCache, useDeskCache, writeDeskCache } from "@/lib/desk-cache";
import type { EvidenceEnvelope, ToolName } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { DeskHeaderActions, DeskResultArea, type DeskError } from "./desk-chrome";

type MarketViewMode = "both" | "overview" | "regime";

const MODE_OPTIONS: {
  id: MarketViewMode;
  labelEn: string;
  labelId: string;
  tools: ToolName[];
}[] = [
  {
    id: "both",
    labelEn: "Overview + Regime",
    labelId: "Ringkasan + Kondisi Pasar",
    tools: ["get_market_overview", "analyze_market_regime"],
  },
  {
    id: "overview",
    labelEn: "Market Overview",
    labelId: "Ringkasan Pasar",
    tools: ["get_market_overview"],
  },
  {
    id: "regime",
    labelEn: "Regime Only",
    labelId: "Kondisi Pasar Saja",
    tools: ["analyze_market_regime"],
  },
];

interface MarketCachedPayload {
  mode: MarketViewMode;
  quote: string;
  envelopes: EvidenceEnvelope[];
}

export function MarketDesk() {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const lastCached = useDeskCache<MarketCachedPayload>("market:last");

  const [modeOverride, setModeOverride] = useState<MarketViewMode | null>(null);
  const [quoteOverride, setQuoteOverride] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<DeskError | null>(null);
  const [liveEnvelopes, setLiveEnvelopes] = useState<EvidenceEnvelope[] | null>(null);
  const [liveCachedAt, setLiveCachedAt] = useState<number | null>(null);
  const initialized = useRef(false);

  const mode = modeOverride ?? lastCached?.value.mode ?? "both";
  const quote = quoteOverride ?? lastCached?.value.quote ?? "USD";
  const envelopes = liveEnvelopes ?? lastCached?.value.envelopes ?? [];
  const cachedAt = liveCachedAt ?? lastCached?.cachedAt ?? null;

  const run = useCallback(
    async (overrides?: { quote?: string; mode?: MarketViewMode }) => {
      const activeMode = overrides?.mode ?? mode;
      const activeQuote = (overrides?.quote ?? quote).trim().toUpperCase() || "USD";
      const tools = MODE_OPTIONS.find((item) => item.id === activeMode)?.tools ?? MODE_OPTIONS[0].tools;

      setRunning(true);
      setError(null);
      const results = await Promise.all(
        tools.map((tool) => runIntelligenceTool(tool, { quote_currency: activeQuote })),
      );
      setRunning(false);

      const next = results.flatMap((result) => (result.ok ? [result.data] : []));
      const failed = results.find((result) => !result.ok);
      if (next.length > 0) {
        setLiveEnvelopes(next);
        const payload: MarketCachedPayload = {
          mode: activeMode,
          quote: activeQuote,
          envelopes: next,
        };
        const ts = writeDeskCache(`market:${activeQuote}:${activeMode}`, payload);
        writeDeskCache("market:last", payload);
        setLiveCachedAt(ts);
      }
      setError(
        failed && !failed.ok
          ? {
              status: failed.status,
              message: failed.message,
              retryAfterSeconds: failed.retryAfterSeconds,
            }
          : null,
      );
    },
    [mode, quote],
  );

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (readDeskCache<MarketCachedPayload>("market:last")?.value.envelopes.length) {
      return;
    }
    void Promise.resolve().then(() => void run());
  }, [run]);

  function handleSelectMode(nextMode: MarketViewMode) {
    setModeOverride(nextMode);
    const cached = readDeskCache<MarketCachedPayload>(`market:${quote}:${nextMode}`);
    if (cached && cached.value.envelopes.length > 0) {
      setLiveEnvelopes(cached.value.envelopes);
      setLiveCachedAt(cached.cachedAt);
      setError(null);
      return;
    }
    if (!running) void run({ mode: nextMode });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].market}
        description={copy.marketBody}
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

      <div className="ct-surface-featured flex flex-wrap items-center justify-between gap-3 rounded-[16px] px-4 py-3.5 sm:px-5">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
          {locale === "id" ? "Tampilan Pasar" : "Market View"}
        </span>

        <div
          role="group"
          aria-label={locale === "id" ? "Mode ringkasan pasar" : "Market view mode"}
          className="flex flex-wrap items-center gap-1.5"
        >
          {MODE_OPTIONS.map((opt) => {
            const active = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={running}
                onClick={() => handleSelectMode(opt.id)}
                className={`min-h-8 cursor-pointer rounded-full border px-3.5 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                  active
                    ? "border-primary/50 bg-primary/14 text-link"
                    : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
                }`}
              >
                {locale === "id" ? opt.labelId : opt.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      <DeskResultArea
        running={running}
        error={error}
        envelopes={envelopes}
        cachedAt={cachedAt}
        onRetry={() => void run()}
        emptyIcon={<LineChart className="h-5 w-5 text-link" aria-hidden="true" />}
        emptyTitle={locale === "id" ? "Siap memuat kondisi pasar" : "Ready to inspect market regime"}
        emptyDescription={
          locale === "id"
            ? "Klik jalankan untuk melihat kapitalisasi global, dominasi BTC, dan klasifikasi rezim pasar."
            : "Click run to load global market cap, BTC dominance, and deterministic regime classification."
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
