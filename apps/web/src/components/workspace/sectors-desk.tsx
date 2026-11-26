"use client";

import { Layers, Play, RefreshCw } from "lucide-react";
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
import type { EvidenceEnvelope, SectorSlug } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { ResultStack } from "./result-stack";

const QUICK_QUOTES = ["USD", "EUR", "BTC"] as const;
const ALL_SECTORS: SectorSlug[] = SECTOR_OPTIONS.map((item) => item.slug);

const SECTOR_PRESETS: {
  id: string;
  labelEn: string;
  labelId: string;
  sectors: SectorSlug[];
}[] = [
  {
    id: "all",
    labelEn: "All 7 Sectors",
    labelId: "Semua 7 Sektor",
    sectors: ALL_SECTORS,
  },
  {
    id: "infra",
    labelEn: "Core Infra & DeFi",
    labelId: "Infra Inti & DeFi",
    sectors: ["layer-1", "layer-2", "defi"],
  },
  {
    id: "narratives",
    labelEn: "Growth Narratives",
    labelId: "Narasi Pertumbuhan",
    sectors: ["ai-big-data", "rwa", "gaming", "memes"],
  },
];

export function SectorsDesk() {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);

  const [quote, setQuote] = useState("USD");
  const [sectors, setSectors] = useState<SectorSlug[]>(ALL_SECTORS);
  const [running, setRunning] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<{
    status: number;
    message: string;
    retryAfterSeconds?: number;
  } | null>(null);
  const [envelopes, setEnvelopes] = useState<EvidenceEnvelope[]>([]);

  async function run(overrides?: { quote?: string; sectors?: SectorSlug[] }) {
    const activeSectors = overrides?.sectors ?? sectors;
    if (activeSectors.length === 0) {
      setValidation(
        locale === "id"
          ? "Pilih minimal satu sektor untuk dibandingkan."
          : "Select at least one sector to compare.",
      );
      return;
    }
    setValidation(null);
    setRunning(true);
    setError(null);
    const result = await runIntelligenceTool("analyze_sector_rotation", {
      quote_currency: (overrides?.quote ?? quote).trim().toUpperCase() || "USD",
      sectors: activeSectors,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].sectors}
        description={copy.sectorsBody}
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
            {locale === "id"
              ? `Pilih Sektor (${sectors.length}/${SECTOR_OPTIONS.length})`
              : `Select Sectors (${sectors.length}/${SECTOR_OPTIONS.length})`}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            {SECTOR_PRESETS.map((preset) => {
              const isMatch =
                preset.sectors.length === sectors.length &&
                preset.sectors.every((slug) => sectors.includes(slug));
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={running}
                  onClick={() => {
                    setSectors(preset.sectors);
                    if (!running) void run({ sectors: preset.sectors });
                  }}
                  className={`min-h-8 cursor-pointer rounded-full border px-3 font-mono text-[11px] font-medium transition-colors disabled:opacity-50 ${
                    isMatch
                      ? "border-primary/50 bg-primary/14 text-link"
                      : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  {locale === "id" ? preset.labelId : preset.labelEn}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
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
                  className={`min-h-9 cursor-pointer rounded-[10px] border px-3.5 font-mono text-xs font-medium transition-colors ${
                    active
                      ? sector.highlighted
                        ? "border-accent/55 bg-accent/14 text-accent"
                        : "border-primary/50 bg-primary/14 text-link"
                      : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  {sector.label}
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="md"
            loading={running}
            onClick={() => void run()}
          >
            {!running ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            <span>{locale === "id" ? "Bandingkan" : "Compare"}</span>
          </Button>
        </div>
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
          icon={<Layers className="h-5 w-5 text-link" aria-hidden="true" />}
          title={locale === "id" ? "Siap membandingkan rotasi sektor" : "Ready to analyze sector rotation"}
          description={
            locale === "id"
              ? "Pilih sektor di atas untuk melihat aliran modal dan perbandingan performa."
              : "Pick sectors above to inspect capital rotation and relative performance."
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
