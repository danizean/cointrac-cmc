"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Layers,
  ShieldAlert,
  Star,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Badge, Button, Skeleton } from "@/components/ui/primitives";
import {
  formatCompactUsd,
  formatPct,
  formatUsd,
  formatUtc,
  pctToneClass,
} from "@/lib/format";
import {
  confidenceBadgeTone,
  eligibilityBadgeTone,
  formatScore,
  formatWeightCoverage,
  type CandidateDetail,
  type CandidateSummary,
} from "@/lib/hidden-gems-types";
import type { Locale } from "@/lib/i18n";

function scoreBarColor(score: number | null): string {
  if (score === null) return "bg-muted-foreground/40";
  if (score >= 80) return "bg-positive";
  if (score >= 65) return "bg-primary";
  return "bg-warning";
}

function formatObservedValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value.toFixed(4).replace(/\.?0+$/, "");
  }
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function HiddenGemDetailModal({
  open,
  loading,
  error,
  detail,
  variants = [],
  locale,
  watched,
  onSelectVariant,
  onToggleWatchlist,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  detail: CandidateDetail | null;
  variants?: CandidateSummary[];
  locale: Locale;
  watched: boolean;
  onSelectVariant?: (candidateId: string) => void;
  onToggleWatchlist: (candidate: CandidateDetail["candidate"]) => void;
  onClose: () => void;
}) {
  const c = detail?.candidate;
  const title = c ? `${c.symbol} · ${c.name}` : locale === "id" ? "Detail Kandidat" : "Candidate Detail";
  const subtitle = c
    ? `${c.discovery_track} · ${c.trading_horizon} · CMC #${c.canonical_provider_id} · ${c.score_version}`
    : undefined;

  const sortedComponents = detail
    ? Object.entries(detail.component_scores).sort(
        ([, a], [, b]) => (b.effective_weight ?? 0) - (a.effective_weight ?? 0),
      )
    : [];

  const cp = detail?.outcome_checkpoint ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={subtitle}
      maxWidthClass="max-w-3xl"
    >
      {variants.length > 1 && onSelectVariant ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-[10px] border border-border bg-card p-2">
          <span className="inline-flex items-center gap-1 px-2 text-[11px] font-medium text-muted-foreground">
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            {locale === "id" ? "Jalur Penilaian:" : "Track / Horizon:"}
          </span>
          {variants.map((variant) => {
            const active = c?.id === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                disabled={loading}
                onClick={() => onSelectVariant(variant.id)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                  active
                    ? "border-primary/50 bg-primary/12 text-foreground"
                    : "border-border bg-card-elevated text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span>
                  {variant.discovery_track}/{variant.trading_horizon === "SHORT_TERM" ? "ST" : "SWING"}
                </span>
                <span className="tabular-nums text-foreground">
                  {formatScore(variant.adjusted_score)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3 py-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-[12px] border border-destructive/40 bg-destructive-soft p-4 text-xs text-destructive">
          {error}
        </div>
      ) : detail && c ? (
        <div className="space-y-5 text-xs">
          {/* Header KPI Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-card-elevated p-3.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={eligibilityBadgeTone(c.eligibility_status)}>
                {c.eligibility_status}
              </Badge>
              <Badge tone={confidenceBadgeTone(c.confidence_level)}>
                {c.confidence_level}
              </Badge>
              <Badge tone="neutral">{c.classification}</Badge>
              <Badge tone="neutral">{c.liquidity_mode}</Badge>
              {c.badges.map((badge) => (
                <Badge key={badge} tone="brand">
                  {badge}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {c.source_timestamp ? (
                <span className="font-mono text-[10px] text-subtle-foreground">
                  {formatUtc(c.source_timestamp)}
                </span>
              ) : null}
              <Button
                size="sm"
                variant={watched ? "primary" : "secondary"}
                onClick={() => onToggleWatchlist(c)}
              >
                <Star className="h-3.5 w-3.5" aria-hidden="true" />
                {watched
                  ? locale === "id"
                    ? "Di Watchlist"
                    : "Watchlisted"
                  : locale === "id"
                    ? "Simpan Watchlist"
                    : "Add to Watchlist"}
              </Button>
            </div>
          </div>

          {/* Core Metrics & Confidence Sub-Scores */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-[10px] border border-border bg-card p-3">
              <p className="text-[11px] text-subtle-foreground">
                {locale === "id" ? "Skor Penyesuaian" : "Adjusted Score"}
              </p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {formatScore(c.adjusted_score)}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">/ 100</span>
              </p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${scoreBarColor(c.adjusted_score)}`}
                  style={{
                    width: `${c.adjusted_score !== null ? Math.max(0, Math.min(100, c.adjusted_score)) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                Raw {formatScore(c.raw_score)} · Cov {formatWeightCoverage(c.valid_weight_coverage)}
              </p>
            </div>
            <div className="rounded-[10px] border border-border bg-card p-3">
              <p className="text-[11px] text-subtle-foreground">
                {locale === "id" ? "Harga, Kap & Vol 24j" : "Price, Cap & Vol"}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatUsd(c.price)}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                MCap {formatCompactUsd(c.market_cap)}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-subtle-foreground">
                Vol {formatCompactUsd(c.volume_24h)}
              </p>
            </div>
            <div className="rounded-[10px] border border-border bg-card p-3">
              <p className="text-[11px] text-subtle-foreground">24h / 7d / RS BTC</p>
              <p
                className={`mt-1 font-mono text-sm font-semibold tabular-nums ${pctToneClass(c.return_24h)}`}
              >
                {formatPct(c.return_24h, { signed: true })}
              </p>
              <p className={`mt-1 font-mono text-[11px] tabular-nums ${pctToneClass(c.return_7d)}`}>
                7d {formatPct(c.return_7d, { signed: true })}
              </p>
              <p className={`mt-0.5 font-mono text-[11px] tabular-nums ${pctToneClass(c.rs_btc_7d)}`}>
                RS {c.rs_btc_7d !== null ? `${c.rs_btc_7d >= 0 ? "+" : ""}${c.rs_btc_7d.toFixed(1)} pp` : "—"}
              </p>
            </div>
            <div className="rounded-[10px] border border-border bg-card p-3">
              <p className="text-[11px] text-subtle-foreground">Confidence Matrix</p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-foreground">
                Data: <span className="font-semibold">{Math.round(c.data_confidence)}</span> · Sig:{" "}
                <span className="font-semibold">{Math.round(c.signal_confidence)}</span>
              </p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                Liquidity: <span className="font-semibold text-foreground">{Math.round(c.liquidity_confidence)}</span>
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-subtle-foreground">{c.liquidity_mode}</p>
            </div>
          </div>

          {/* Forward Outcome Checkpoint Ledger */}
          {cp ? (
            <div className="rounded-[12px] border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-link" aria-hidden="true" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {locale === "id"
                      ? "Evaluasi Forward Outcome"
                      : "Forward Outcome Checkpoints"}
                  </h3>
                </div>
                <span className="font-mono text-[10px] text-subtle-foreground">
                  Entry {formatUsd(cp.entry_price)} · BTC {formatUsd(cp.entry_btc_price)} ·{" "}
                  {formatUtc(cp.entry_observed_at)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums sm:grid-cols-5">
                {(
                  [
                    ["T+1d", cp.ret_1d],
                    ["T+3d", cp.ret_3d],
                    ["T+7d", cp.ret_7d],
                    ["T+14d", cp.ret_14d],
                    ["T+30d", cp.ret_30d],
                  ] as const
                ).map(([label, val]) => (
                  <div
                    key={label}
                    className="rounded-[8px] border border-border bg-background px-2.5 py-2"
                  >
                    <span className="block text-[10px] text-subtle-foreground">{label}</span>
                    <span className={`font-semibold ${pctToneClass(val)}`}>
                      {formatPct(val, { signed: true })}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums sm:grid-cols-4">
                <div className="rounded-[8px] border border-border bg-background px-2.5 py-1.5">
                  <span className="text-subtle-foreground">Rel BTC 7d: </span>
                  <span className={pctToneClass(cp.rel_btc_7d)}>
                    {formatPct(cp.rel_btc_7d, { signed: true })}
                  </span>
                </div>
                <div className="rounded-[8px] border border-border bg-background px-2.5 py-1.5">
                  <span className="text-subtle-foreground">Rel BTC 30d: </span>
                  <span className={pctToneClass(cp.rel_btc_30d)}>
                    {formatPct(cp.rel_btc_30d, { signed: true })}
                  </span>
                </div>
                <div className="rounded-[8px] border border-border bg-background px-2.5 py-1.5">
                  <span className="text-subtle-foreground">MFE 30d: </span>
                  <span className={pctToneClass(cp.mfe_30d)}>
                    {formatPct(cp.mfe_30d, { signed: true })}
                  </span>
                </div>
                <div className="rounded-[8px] border border-border bg-background px-2.5 py-1.5">
                  <span className="text-subtle-foreground">MAE 30d: </span>
                  <span className={pctToneClass(cp.mae_30d)}>
                    {formatPct(cp.mae_30d, { signed: true })}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {/* 6-Component Quantitative Breakdown */}
          <div className="rounded-[12px] border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {locale === "id" ? "Rincian Komponen Skor" : "Quantitative Component Breakdown"}
            </h3>
            <div className="mt-3 space-y-2.5">
              {sortedComponents.map(([name, comp]) => {
                const scoreVal = typeof comp.score === "number" ? comp.score : null;
                const widthPct = scoreVal !== null ? Math.max(0, Math.min(100, scoreVal)) : 0;
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                      <span className="font-medium text-foreground">{name}</span>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>w={Math.round((comp.effective_weight ?? 0) * 100)}%</span>
                        <Badge tone={comp.quality_status === "VALID" ? "neutral" : "warning"}>
                          {comp.quality_status}
                        </Badge>
                        <span className="w-10 text-right font-semibold tabular-nums text-foreground">
                          {formatScore(scoreVal)}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${scoreBarColor(scoreVal)}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {c.missing_components.length > 0 ? (
              <p className="mt-3 text-[11px] text-warning">
                {locale === "id"
                  ? "Komponen tidak tersedia (dipertahankan null, bukan nol): "
                  : "Missing components (retained null, never zero): "}
                <span className="font-mono">{c.missing_components.join(", ")}</span>
              </p>
            ) : null}
          </div>

          {/* Penalties & Rejection Notes */}
          {detail.penalties.length > 0 || detail.rejection_reasons.length > 0 ? (
            <div className="rounded-[12px] border border-warning/40 bg-warning-soft p-3.5 text-foreground">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                {locale === "id" ? "Penalti & Pembatasan" : "Penalties & Eligibility Constraints"}
              </div>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {detail.penalties.map((p, idx) => (
                  <li key={`${p.code}-${idx}`}>
                    [-{p.points.toFixed(1)}] {p.code}: {p.reason}
                  </li>
                ))}
                {detail.rejection_reasons.map((r, idx) => (
                  <li key={`${r.code}-${idx}`}>
                    [{r.stage}/{r.code}] {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Deterministic Stage 8 Explanation */}
          {detail.explanation ? (
            <div className="space-y-3 rounded-[12px] border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden="true" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {locale === "id"
                    ? "Penjelasan Deterministik (Tersitasi Bukti)"
                    : "Deterministic Evidence-Cited Thesis"}
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-foreground">
                {detail.explanation.summary}
              </p>
              {detail.explanation.why_discovered.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="font-semibold text-muted-foreground">
                    {locale === "id" ? "Pemicu Utama:" : "Key Discovery Drivers:"}
                  </p>
                  <ul className="space-y-1">
                    {detail.explanation.why_discovered.map((item, idx) => (
                      <li key={`${item.evidence_id}-${idx}`} className="flex items-start gap-2">
                        <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          #{item.evidence_id.slice(0, 8)}
                        </span>
                        <span className="text-foreground">{item.claim}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {detail.explanation.key_risks.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="font-semibold text-warning">
                    {locale === "id" ? "Risiko Utama:" : "Key Risks:"}
                  </p>
                  <ul className="space-y-1">
                    {detail.explanation.key_risks.map((item, idx) => (
                      <li key={`${item.evidence_id}-risk-${idx}`} className="flex items-start gap-2">
                        <ShieldAlert
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                          aria-hidden="true"
                        />
                        <span className="text-foreground">
                          {item.risk ?? item.claim}{" "}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            (#{item.evidence_id.slice(0, 8)})
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Provenance Evidence Rows */}
          <div className="rounded-[12px] border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-link" aria-hidden="true" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {locale === "id"
                  ? `Bukti Terpersistensi (${detail.evidence.length})`
                  : `Persisted Evidence Records (${detail.evidence.length})`}
              </h3>
            </div>
            {detail.evidence.length === 0 ? (
              <p className="mt-2 text-muted-foreground">
                {locale === "id" ? "Belum ada bukti tercatat." : "No evidence records stored."}
              </p>
            ) : (
              <div className="mt-2.5 max-h-56 space-y-2 overflow-y-auto pr-1">
                {detail.evidence.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-[8px] border border-border bg-background p-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-foreground">
                        {ev.metric_name}{" "}
                        <span className="font-normal text-link">
                          = {formatObservedValue(ev.observed_value)}
                        </span>{" "}
                        <span className="font-normal text-subtle-foreground">
                          · #{ev.id.slice(0, 8)}
                        </span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          tone={
                            ev.direction === "POSITIVE"
                              ? "positive"
                              : ev.direction === "NEGATIVE"
                                ? "destructive"
                                : "neutral"
                          }
                        >
                          {ev.direction}
                        </Badge>
                        <Badge tone="neutral">{ev.quality_status}</Badge>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{ev.interpretation}</p>
                    <p className="mt-1 font-mono text-[10px] text-subtle-foreground">
                      {ev.source_provider} {ev.source_endpoint} · {formatUtc(ev.source_timestamp)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Score Delta History */}
          {detail.score_history.length > 0 ? (
            <div className="rounded-[12px] border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {locale === "id" ? "Riwayat Pergerakan Skor" : "Score Movement History"}
              </h3>
              <div className="mt-2 space-y-1.5 font-mono text-[11px]">
                {detail.score_history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {formatUtc(h.observed_at)} · {h.discovery_track}/{h.trading_horizon}
                    </span>
                    <span className="tabular-nums text-foreground">
                      {formatScore(h.previous_score)} → {formatScore(h.current_score)} (
                      <span className={pctToneClass(h.score_delta)}>
                        {h.score_delta !== null
                          ? `${h.score_delta > 0 ? "+" : ""}${h.score_delta.toFixed(1)}`
                          : "—"}
                      </span>
                      )
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
