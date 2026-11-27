"use client";

import { Activity, Play } from "lucide-react";
import { useCallback, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { Button, PageHeader } from "@/components/ui/primitives";
import { runIntelligenceTool } from "@/lib/api";
import { useDeskCache, writeDeskCache } from "@/lib/desk-cache";
import type { EvidenceEnvelope } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { DeskHeaderActions, DeskResultArea, type DeskError } from "./desk-chrome";

interface ScopeOption {
  size: number;
  labelEn: string;
  labelId: string;
  hintEn: string;
  hintId: string;
}

const SCOPE_OPTIONS: ScopeOption[] = [
  {
    size: 50,
    labelEn: "Top 50",
    labelId: "Top 50",
    hintEn: "Core large-cap leaders",
    hintId: "Koin utama paling likuid",
  },
  {
    size: 100,
    labelEn: "Top 100",
    labelId: "Top 100",
    hintEn: "Large & mid-cap leaders",
    hintId: "Koin besar & menengah",
  },
  {
    size: 150,
    labelEn: "Top 150",
    labelId: "Top 150",
    hintEn: "Balanced market coverage",
    hintId: "Cakupan pasar seimbang",
  },
  {
    size: 200,
    labelEn: "Top 200",
    labelId: "Top 200",
    hintEn: "Maximum scanner scope (200)",
    hintId: "Batas maks pemindaian (200)",
  },
];

interface AnomaliesCachedPayload {
  quote: string;
  universe: number;
  envelopes: EvidenceEnvelope[];
}

export function AnomaliesDesk() {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const cached = useDeskCache<AnomaliesCachedPayload>("anomalies:last");

  const [quoteOverride, setQuoteOverride] = useState<string | null>(null);
  const [universeOverride, setUniverseOverride] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<DeskError | null>(null);
  const [liveEnvelopes, setLiveEnvelopes] = useState<EvidenceEnvelope[] | null>(null);
  const [liveCachedAt, setLiveCachedAt] = useState<number | null>(null);

  const quote = quoteOverride ?? cached?.value.quote ?? "USD";
  const universe = universeOverride ?? cached?.value.universe ?? 150;
  const envelopes = liveEnvelopes ?? cached?.value.envelopes ?? [];
  const cachedAt = liveCachedAt ?? cached?.cachedAt ?? null;

  const run = useCallback(
    async (overrides?: { quote?: string; universe?: number }) => {
      const nextQuote = (overrides?.quote ?? quote).trim().toUpperCase() || "USD";
      const nextUniverse = overrides?.universe ?? universe;
      setRunning(true);
      setError(null);
      const result = await runIntelligenceTool("detect_market_anomalies", {
        quote_currency: nextQuote,
        universe_size: nextUniverse,
      });
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
      const ts = writeDeskCache<AnomaliesCachedPayload>("anomalies:last", {
        quote: nextQuote,
        universe: nextUniverse,
        envelopes: next,
      });
      setLiveCachedAt(ts);
    },
    [quote, universe],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].anomalies}
        description={copy.anomaliesBody}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Cakupan Pemindaian" : "Scan Scope"}
          </span>
          <span className="font-mono text-[11px] text-subtle-foreground">
            {locale === "id"
              ? "Deteksi: Lonjakan Volume · Anomali Harga · Divergensi BTC"
              : "Detects: Volume Spikes · Price Outliers · BTC Divergences"}
          </span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {SCOPE_OPTIONS.map((opt) => {
            const active = universe === opt.size;
            return (
              <button
                key={opt.size}
                type="button"
                disabled={running}
                onClick={() => {
                  setUniverseOverride(opt.size);
                  if (!running) void run({ universe: opt.size });
                }}
                className={`cursor-pointer rounded-[12px] border p-3 text-left transition-all disabled:opacity-60 ${
                  active
                    ? "border-primary/55 bg-primary/12 shadow-[0_0_20px_-8px_rgba(6,182,212,0.45)]"
                    : "border-border bg-background/70 hover:border-border-strong hover:bg-card-elevated/60"
                }`}
              >
                <p className={`font-mono text-xs font-semibold ${active ? "text-link" : "text-foreground"}`}>
                  {locale === "id" ? opt.labelId : opt.labelEn}
                </p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {locale === "id" ? opt.hintId : opt.hintEn}
                </p>
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
        emptyIcon={<Activity className="h-5 w-5 text-link" aria-hidden="true" />}
        emptyTitle={locale === "id" ? "Siap mendeteksi anomali pasar" : "Ready to scan market anomalies"}
        emptyDescription={
          locale === "id"
            ? "Pilih cakupan koin di atas untuk mendeteksi lonjakan volume dan pergerakan harga tidak wajar."
            : "Select a scan scope above to spot unusual volume spikes and price moves."
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
