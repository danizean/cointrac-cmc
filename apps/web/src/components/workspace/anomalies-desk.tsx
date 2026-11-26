"use client";

import { Activity, Play, RefreshCw } from "lucide-react";
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
import type { EvidenceEnvelope } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { ResultStack } from "./result-stack";

const QUICK_QUOTES = ["USD", "EUR", "BTC"] as const;

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

export function AnomaliesDesk() {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);

  const [quote, setQuote] = useState("USD");
  const [universe, setUniverse] = useState(150);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{
    status: number;
    message: string;
    retryAfterSeconds?: number;
  } | null>(null);
  const [envelopes, setEnvelopes] = useState<EvidenceEnvelope[]>([]);
  const autoStarted = useRef(false);

  async function run(overrides?: { quote?: string; universe?: number }) {
    setRunning(true);
    setError(null);
    const result = await runIntelligenceTool("detect_market_anomalies", {
      quote_currency: (overrides?.quote ?? quote).trim().toUpperCase() || "USD",
      universe_size: overrides?.universe ?? universe,
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
    setEnvelopes([result.data]);
  }

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    const timer = window.setTimeout(() => {
      void run();
    }, 0);
    return () => window.clearTimeout(timer);
    // Run initial anomaly scan automatically on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].anomalies}
        description={copy.anomaliesBody}
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
                      if (!running) void run({ quote: q });
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
                  setUniverse(opt.size);
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
          title={locale === "id" ? "Siap mendeteksi anomali pasar" : "Ready to scan market anomalies"}
          description={
            locale === "id"
              ? "Pilih cakupan koin di atas untuk mendeteksi lonjakan volume dan pergerakan harga tidak wajar."
              : "Select a scan scope above to spot unusual volume spikes and price moves."
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
