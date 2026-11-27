"use client";

import { Check, Loader2, Radar, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import {
  HIDDEN_GEM_PIPELINE_STAGES,
  formatElapsedDuration,
  parseScanProgress,
  type HiddenGemStageCode,
  type ScanRunSummary,
} from "@/lib/hidden-gems-types";
import type { Locale } from "@/lib/i18n";

const STAGE_COPY: Record<
  HiddenGemStageCode,
  { id: { title: string; detail: string }; en: { title: string; detail: string } }
> = {
  PREFLIGHT: {
    id: {
      title: "Preflight & Rezim",
      detail: "Cek profil tier CMC, kuota budget & klasifikasi rezim makro",
    },
    en: {
      title: "Preflight & Regime",
      detail: "Checking CMC capability tier, credit budget & macro regime",
    },
  },
  INGESTION: {
    id: {
      title: "Ingest Pasar",
      detail: "Mengambil snapshot universe pasar CoinMarketCap",
    },
    en: {
      title: "Market Ingestion",
      detail: "Ingesting top market-cap universe snapshots",
    },
  },
  HARD_GATES: {
    id: {
      title: "Filter Hard-Gate",
      detail: "Evaluasi likuiditas, Vol/MCap, umur listing & anti-chase",
    },
    en: {
      title: "Hard-Gate Screening",
      detail: "Evaluating liquidity floor, Vol/MCap, age & anti-chase gates",
    },
  },
  ENRICHMENT: {
    id: {
      title: "Enrichment",
      detail: "Pengisian metadata historis OHLCV & metrik derivatif finalis",
    },
    en: {
      title: "Deep Enrichment",
      detail: "Fetching finalist metadata, historical candles & derivatives",
    },
  },
  SCORING_PERSIST: {
    id: {
      title: "Skoring & Bukti",
      detail: "Perhitungan skor multi-horizon, bukti & penyimpanan database",
    },
    en: {
      title: "Scoring & Evidence",
      detail: "Computing deterministic multi-horizon scores & audit evidence",
    },
  },
};

export function HiddenGemScanProgress({
  scan,
  locale,
  cancelling,
  onCancel,
}: {
  scan: ScanRunSummary;
  locale: Locale;
  cancelling: boolean;
  onCancel: (scanId: string) => void;
}) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const progress = parseScanProgress(scan);
  const completedSet = new Set(progress.stagesCompleted);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [scan.id]);

  const elapsed = formatElapsedDuration(scan.started_at ?? scan.created_at, nowMs);
  const activeStageMeta =
    progress.stageCode in STAGE_COPY
      ? STAGE_COPY[progress.stageCode as HiddenGemStageCode][locale]
      : null;

  return (
    <Card elevated className="overflow-hidden border-primary/35 p-4 sm:p-5 space-y-4">
      {/* Header strip */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-primary/35 bg-primary/12 text-link">
            <span
              className="absolute inset-0 rounded-[10px] border border-primary/40 motion-safe:animate-ping opacity-30"
              aria-hidden="true"
            />
            <Radar className="h-4 w-4 motion-safe:animate-pulse" aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {scan.status === "QUEUED"
                  ? locale === "id"
                    ? "Menyiapkan Antrean Discovery Scan"
                    : "Queueing Discovery Scan"
                  : locale === "id"
                    ? "Discovery Scan Sedang Berjalan"
                    : "Discovery Scan in Progress"}
              </span>
              <Badge tone="info">
                <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
                {scan.status}
              </Badge>
              <span className="font-mono text-[11px] text-subtle-foreground">
                #{scan.id.slice(0, 8)} · {scan.discovery_track}/{scan.trading_horizon}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {activeStageMeta
                ? `${activeStageMeta.title} — ${activeStageMeta.detail}`
                : locale === "id"
                  ? "Menunggu worker mengeksekusi pipeline deterministik..."
                  : "Waiting for deterministic pipeline worker..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right font-mono">
            <p className="text-[10px] uppercase tracking-wider text-subtle-foreground">
              {locale === "id" ? "Durasi Berjalan" : "Elapsed"}
            </p>
            <p className="text-sm font-semibold tabular-nums text-foreground">{elapsed}</p>
          </div>
          <Button
            size="sm"
            variant="danger"
            loading={cancelling}
            onClick={() => onCancel(scan.id)}
          >
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            {locale === "id" ? "Batalkan" : "Cancel"}
          </Button>
        </div>
      </div>

      {/* Deterministic stage progress bar (strictly completed_stages / 5, never interpolated) */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
          <span className="text-muted-foreground">
            {locale === "id"
              ? `Tahap ${progress.stageIndex} dari ${progress.stageTotal} · ${progress.completedCount} selesai`
              : `Stage ${progress.stageIndex} of ${progress.stageTotal} · ${progress.completedCount} verified`}
          </span>
          <span className="font-semibold tabular-nums text-foreground">
            {progress.stagePct}%{" "}
            <span className="font-normal text-[10px] text-subtle-foreground">
              ({progress.completedCount}/{progress.stageTotal} stages)
            </span>
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={progress.stagePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Verified hidden gem scan stage progress"
          className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${progress.stagePct}%` }}
          />
          {progress.stagePct < 100 ? (
            <div
              className="absolute inset-y-0 rounded-full bg-primary/35 motion-safe:animate-pulse"
              style={{
                left: `${progress.stagePct}%`,
                width: `${100 / progress.stageTotal}%`,
              }}
            />
          ) : null}
        </div>
      </div>

      {/* 5-Stage Pipeline Stepper */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {HIDDEN_GEM_PIPELINE_STAGES.map((code, idx) => {
          const stepNum = idx + 1;
          const isDone = completedSet.has(code);
          const isActive = !isDone && progress.stageCode === code;
          const copy = STAGE_COPY[code][locale];

          let metricTag: string | null = null;
          if (code === "PREFLIGHT" && isDone) {
            metricTag = scan.effective_tier;
          } else if (code === "INGESTION" && progress.universeIngested !== null) {
            metricTag = `${progress.universeIngested} assets`;
          } else if (code === "HARD_GATES" && progress.hardGatePassed !== null) {
            metricTag = `${progress.hardGatePassed} passed`;
          } else if (code === "ENRICHMENT" && progress.enrichmentTargets !== null && isDone) {
            metricTag = `${progress.enrichmentTargets} enriched`;
          } else if (code === "SCORING_PERSIST" && progress.candidatesScored !== null) {
            metricTag = `${progress.candidatesScored} scored`;
          }

          return (
            <div
              key={code}
              className={`rounded-[10px] border p-2.5 transition-colors ${
                isDone
                  ? "border-positive/35 bg-positive-soft/60"
                  : isActive
                    ? "border-primary/45 bg-primary/10"
                    : "border-border bg-card/70 opacity-75"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${
                      isDone
                        ? "bg-positive text-on-positive"
                        : isActive
                          ? "bg-primary text-on-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : isActive ? (
                      <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      stepNum
                    )}
                  </span>
                  <span className="text-[11px] font-semibold text-foreground">{copy.title}</span>
                </div>
              </div>
              <p className="mt-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {metricTag ??
                  (isDone
                    ? locale === "id"
                      ? "Selesai"
                      : "Done"
                    : isActive
                      ? locale === "id"
                        ? "Memproses..."
                        : "Running..."
                      : locale === "id"
                        ? "Menunggu"
                        : "Pending")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Real-time observed telemetry strip (null stays —, zero fake counters) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
          <span>
            Ingested:{" "}
            <strong className="text-foreground">
              {progress.universeIngested !== null
                ? `${progress.universeIngested} / ${scan.universe_requested}`
                : `— / ${scan.universe_requested}`}
            </strong>
          </span>
          <span>
            Passed Gates:{" "}
            <strong className="text-positive">
              {progress.hardGatePassed !== null ? progress.hardGatePassed : "—"}
            </strong>
          </span>
          <span>
            Rejected:{" "}
            <strong className="text-foreground">
              {progress.hardGateRejected !== null ? progress.hardGateRejected : "—"}
            </strong>
          </span>
          <span>
            Credits Spent:{" "}
            <strong className="text-foreground">{scan.cmc_credits_consumed} cr</strong>
          </span>
        </div>
        <span className="text-[10px] text-subtle-foreground">
          {locale === "id"
            ? "Progres dihitung murni dari checkpoint stage backend (tanpa estimasi fiktif)."
            : "Progress equals verified completed backend stages ÷ 5 (no interpolated estimates)."}
        </span>
      </div>
    </Card>
  );
}
