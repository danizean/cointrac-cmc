"use client";

import { AlertTriangle, CheckCircle2, FileSearch, ShieldAlert, Star } from "lucide-react";
import { Badge, Button, Skeleton } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
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
} from "@/lib/hidden-gems-types";
import type { Locale } from "@/lib/i18n";

export function HiddenGemDetailModal({
  open,
  loading,
  error,
  detail,
  locale,
  watched,
  onToggleWatchlist,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  detail: CandidateDetail | null;
  locale: Locale;
  watched: boolean;
  onToggleWatchlist: (candidate: CandidateDetail["candidate"]) => void;
  onClose: () => void;
}) {
  const c = detail?.candidate;
  const title = c ? `${c.symbol} · ${c.name}` : locale === "id" ? "Detail Kandidat" : "Candidate Detail";
  const subtitle = c
    ? `${c.discovery_track} · ${c.trading_horizon} · CMC #${c.canonical_provider_id} · ${c.score_version}`
    : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={subtitle}
      maxWidthClass="max-w-3xl"
    >
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
            <div className="flex flex-wrap items-center gap-2">
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

          {/* Core Metrics & Confidence Sub-Scores */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-[10px] border border-border bg-card p-3">
              <p className="text-[11px] text-subtle-foreground">
                {locale === "id" ? "Skor Penyesuaian" : "Adjusted Score"}
              </p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {formatScore(c.adjusted_score)}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  / 100
                </span>
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                Raw: {formatScore(c.raw_score)} · Cov: {formatWeightCoverage(c.valid_weight_coverage)}
              </p>
            </div>
            <div className="rounded-[10px] border border-border bg-card p-3">
              <p className="text-[11px] text-subtle-foreground">
                {locale === "id" ? "Harga & Kap" : "Price & Cap"}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatUsd(c.price)}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                MCap {formatCompactUsd(c.market_cap)}
              </p>
            </div>
            <div className="rounded-[10px] border border-border bg-card p-3">
              <p className="text-[11px] text-subtle-foreground">24h / 7d / RS BTC</p>
              <p className={`mt-1 font-mono text-sm font-semibold tabular-nums ${pctToneClass(c.return_24h)}`}>
                {formatPct(c.return_24h, { signed: true })}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                7d {formatPct(c.return_7d, { signed: true })} · RS {formatPct(c.rs_btc_7d, { signed: true })}
              </p>
            </div>
            <div className="rounded-[10px] border border-border bg-card p-3">
              <p className="text-[11px] text-subtle-foreground">Confidence Matrix</p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-foreground">
                Data: {Math.round(c.data_confidence)} · Sig: {Math.round(c.signal_confidence)}
              </p>
              <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                Liq: {Math.round(c.liquidity_confidence)} ({c.liquidity_mode})
              </p>
            </div>
          </div>

          {/* 6-Component Quantitative Breakdown */}
          <div className="rounded-[12px] border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {locale === "id" ? "Rincian Komponen Skor" : "Quantitative Component Breakdown"}
            </h3>
            <div className="mt-3 space-y-2.5">
              {Object.entries(detail.component_scores).map(([name, comp]) => {
                const scoreVal = typeof comp.score === "number" ? comp.score : null;
                const widthPct = scoreVal !== null ? Math.max(0, Math.min(100, scoreVal)) : 0;
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                      <span className="font-medium text-foreground">{name}</span>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>
                          w={Math.round((comp.effective_weight ?? 0) * 100)}%
                        </span>
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
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {c.missing_components.length > 0 ? (
              <p className="mt-3 text-[11px] text-warning">
                {locale === "id" ? "Komponen tidak tersedia (bukan nol): " : "Missing components (retained null): "}
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
            <div className="rounded-[12px] border border-border bg-card p-4 space-y-3">
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
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
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
                        {ev.metric_name} · #{ev.id.slice(0, 8)}
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
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {ev.interpretation}
                    </p>
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
