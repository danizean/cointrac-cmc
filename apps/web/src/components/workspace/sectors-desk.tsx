"use client";

import { Layers, Play } from "lucide-react";
import { useCallback, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { Button, PageHeader } from "@/components/ui/primitives";
import { runIntelligenceTool } from "@/lib/api";
import { SECTOR_OPTIONS } from "@/lib/catalog";
import { useDeskCache, writeDeskCache } from "@/lib/desk-cache";
import type { EvidenceEnvelope, SectorSlug } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { DeskHeaderActions, DeskResultArea, type DeskError } from "./desk-chrome";

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

interface SectorsCachedPayload {
  quote: string;
  sectors: SectorSlug[];
  envelopes: EvidenceEnvelope[];
}

export function SectorsDesk() {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const cached = useDeskCache<SectorsCachedPayload>("sectors:last");

  const [quoteOverride, setQuoteOverride] = useState<string | null>(null);
  const [sectorsOverride, setSectorsOverride] = useState<SectorSlug[] | null>(null);
  const [running, setRunning] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<DeskError | null>(null);
  const [liveEnvelopes, setLiveEnvelopes] = useState<EvidenceEnvelope[] | null>(null);
  const [liveCachedAt, setLiveCachedAt] = useState<number | null>(null);

  const quote = quoteOverride ?? cached?.value.quote ?? "USD";
  const sectors = sectorsOverride ?? cached?.value.sectors ?? ALL_SECTORS;
  const envelopes = liveEnvelopes ?? cached?.value.envelopes ?? [];
  const cachedAt = liveCachedAt ?? cached?.cachedAt ?? null;

  const run = useCallback(
    async (overrides?: { quote?: string; sectors?: SectorSlug[] }) => {
      const activeSectors = overrides?.sectors ?? sectors;
      if (activeSectors.length === 0) {
        setValidation(
          locale === "id"
            ? "Pilih minimal satu sektor untuk dibandingkan."
            : "Select at least one sector to compare.",
        );
        return;
      }
      const nextQuote = (overrides?.quote ?? quote).trim().toUpperCase() || "USD";
      setValidation(null);
      setRunning(true);
      setError(null);
      const result = await runIntelligenceTool("analyze_sector_rotation", {
        quote_currency: nextQuote,
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

      const next = [result.data];
      setLiveEnvelopes(next);
      const ts = writeDeskCache<SectorsCachedPayload>("sectors:last", {
        quote: nextQuote,
        sectors: activeSectors,
        envelopes: next,
      });
      setLiveCachedAt(ts);
    },
    [locale, quote, sectors],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].sectors}
        description={copy.sectorsBody}
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
                    setSectorsOverride(preset.sectors);
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
                    setSectorsOverride((prev) => {
                      const base = prev ?? sectors;
                      return base.includes(sector.slug)
                        ? base.filter((item) => item !== sector.slug)
                        : [...base, sector.slug];
                    })
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

          <Button type="button" variant="secondary" size="md" loading={running} onClick={() => void run()}>
            {!running ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            <span>{locale === "id" ? "Bandingkan" : "Compare"}</span>
          </Button>
        </div>
      </div>

      <DeskResultArea
        running={running}
        error={error}
        validation={validation}
        envelopes={envelopes}
        cachedAt={cachedAt}
        onRetry={() => void run()}
        emptyIcon={<Layers className="h-5 w-5 text-link" aria-hidden="true" />}
        emptyTitle={locale === "id" ? "Siap membandingkan rotasi sektor" : "Ready to analyze sector rotation"}
        emptyDescription={
          locale === "id"
            ? "Pilih sektor di atas untuk melihat aliran modal dan perbandingan performa."
            : "Pick sectors above to inspect capital rotation and relative performance."
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
