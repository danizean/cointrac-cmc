"use client";

import { ChevronDown, Info } from "lucide-react";
import Link from "next/link";
import type { AIStructuredSummaryPayload, AISummaryTone } from "@/lib/control-plane-api";

function tonePillClass(tone: AISummaryTone): string {
  switch (tone) {
    case "positive":
      return "border-positive/35 bg-positive-soft text-positive";
    case "destructive":
      return "border-destructive/40 bg-destructive-soft text-destructive";
    case "warning":
      return "border-warning/40 bg-warning-soft text-warning";
    case "info":
      return "border-info/35 bg-info-soft text-info";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function toneTextClass(tone: AISummaryTone): string {
  switch (tone) {
    case "positive":
      return "text-positive";
    case "destructive":
      return "text-destructive";
    case "warning":
      return "text-warning";
    case "info":
      return "text-link";
    default:
      return "text-foreground";
  }
}

function dataModeBadgeClass(mode: string | null | undefined): string {
  const m = (mode || "").toUpperCase();
  if (m === "LIVE") return "border-positive/35 bg-positive-soft text-positive";
  if (m === "CACHED" || m === "VERIFIED_SNAPSHOT_FALLBACK") {
    return "border-warning/40 bg-warning-soft text-warning";
  }
  return "border-border bg-muted text-muted-foreground";
}

function shortUtcTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.toISOString().slice(11, 16)} UTC`;
}

function MiniSparkline({
  label,
  points,
  pointLabels,
  tone,
}: {
  label: string;
  points: number[];
  pointLabels: string[];
  tone: AISummaryTone;
}) {
  if (points.length < 2) return null;
  const minVal = Math.min(...points);
  const maxVal = Math.max(...points);
  const span = Math.max(maxVal - minVal, 0.5);
  const width = 180;
  const height = 40;
  const padX = 6;
  const padY = 5;

  const coords = points.map((p, idx) => {
    const x = padX + (idx / (points.length - 1)) * (width - padX * 2);
    const y = padY + (1 - (p - minVal) / span) * (height - padY * 2);
    return { x, y };
  });
  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const strokeColor =
    tone === "positive"
      ? "var(--positive)"
      : tone === "destructive"
        ? "var(--destructive)"
        : "var(--link)";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-card/65 px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-subtle-foreground">
          {label}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {pointLabels.join(" → ")}
        </p>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label={label}
        className="shrink-0 overflow-visible"
      >
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polyline}
        />
        {coords.map((c, idx) => (
          <circle key={idx} cx={c.x} cy={c.y} r="2.2" fill={strokeColor} />
        ))}
      </svg>
    </div>
  );
}

export function AIStructuredCard({
  summary,
  locale,
  isAdminSandbox = false,
}: {
  summary: AIStructuredSummaryPayload;
  locale: "en" | "id";
  isAdminSandbox?: boolean;
}) {
  const isId = locale === "id";
  const hasKpis = summary.kpis.length > 0;
  const hasTables = summary.tables.length > 0;
  const hasDetails = summary.details.length > 0;

  return (
    <div className="space-y-3 rounded-[14px] border border-border bg-card/65 p-3.5 sm:p-4">
      {/* Headline Regime / Sentiment Chip */}
      {summary.headline_chip ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${tonePillClass(
                summary.headline_chip.tone,
              )}`}
            >
              <span>{summary.headline_chip.label}</span>
              {summary.headline_chip.sublabel ? (
                <span className="opacity-80">· {summary.headline_chip.sublabel}</span>
              ) : null}
            </span>
          </div>
          {summary.headline_chip.data_mode ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${dataModeBadgeClass(
                summary.headline_chip.data_mode,
              )}`}
            >
              <span>{summary.headline_chip.data_mode}</span>
              {shortUtcTime(summary.headline_chip.source_timestamp) ? (
                <span>· {shortUtcTime(summary.headline_chip.source_timestamp)}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Compact 3-4 KPI Grid */}
      {hasKpis ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {summary.kpis.map((kpi) => {
            const utc = shortUtcTime(kpi.source_timestamp);
            return (
              <div
                key={kpi.label}
                className="flex flex-col justify-between rounded-[11px] border border-border/80 bg-background/65 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
                    {kpi.label}
                  </span>
                  {kpi.data_mode ? (
                    <span
                      title={utc ? `${kpi.data_mode} · ${utc}` : kpi.data_mode}
                      className={`shrink-0 rounded-full border px-1.5 py-px font-mono text-[9px] font-semibold ${dataModeBadgeClass(
                        kpi.data_mode,
                      )}`}
                    >
                      {kpi.data_mode === "LIVE" ? "LIVE" : utc ? utc : kpi.data_mode}
                    </span>
                  ) : null}
                </div>
                <p
                  className={`mt-1 font-mono text-base font-bold tabular-nums sm:text-[17px] ${toneTextClass(
                    kpi.tone,
                  )}`}
                >
                  {kpi.value}
                </p>
                {kpi.sub ? (
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                    {kpi.sub}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Mini Sparkline */}
      {summary.sparkline && summary.sparkline.points.length >= 2 ? (
        <MiniSparkline
          label={summary.sparkline.label}
          points={summary.sparkline.points}
          pointLabels={summary.sparkline.point_labels}
          tone={summary.sparkline.tone}
        />
      ) : null}

      {/* Structured Comparison / Screening / Sector Table */}
      {hasTables
        ? summary.tables.map((table) => (
            <div
              key={table.title}
              className="overflow-x-auto rounded-[12px] border border-border bg-background/65"
            >
              <div className="border-b border-border bg-muted/45 px-3 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-subtle-foreground">
                {table.title}
              </div>
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border/80 font-mono text-[10.5px] uppercase tracking-wider text-subtle-foreground">
                    {table.columns.map((col) => (
                      <th key={col} className="whitespace-nowrap px-3 py-2">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/75 font-mono tabular-nums">
                  {table.rows.map((row, rIdx) => (
                    <tr key={`${table.title}-${rIdx}`} className="hover:bg-muted/35">
                      {row.map((cell, cIdx) => (
                        <td
                          key={`${table.title}-${rIdx}-${cIdx}`}
                          className={`whitespace-nowrap px-3 py-2 ${
                            cIdx === 0 ? "font-sans font-semibold text-foreground" : ""
                          } ${toneTextClass(cell.tone)}`}
                        >
                          {cell.text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        : null}

      {/* Collapsible Detail & Unavailable Fields Accordion (Closed by Default) */}
      {hasDetails ? (
        <details className="group rounded-[11px] border border-border/80 bg-background/55 px-3.5 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>
                {isId
                  ? `Detail metrik & field terbatas (${summary.details.length})`
                  : `Secondary metrics & unavailable fields (${summary.details.length})`}
              </span>
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <dl className="mt-2.5 divide-y divide-border/70 border-t border-border/70 pt-2 text-xs">
            {summary.details.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <dt className="font-medium text-foreground">{item.label}</dt>
                <dd className="font-mono text-[11px] text-muted-foreground sm:text-right">
                  <span className="text-foreground">{item.value}</span>
                  {item.note ? <span className="block text-[10.5px]">{item.note}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
          {!isAdminSandbox ? (
            <div className="mt-2 border-t border-border/60 pt-2 text-[11px]">
              <Link href="/pricing#pricing-byok-heading" className="text-link hover:underline">
                {isId ? "Lihat panduan BYOK & batas tier CMC →" : "See BYOK & CMC tier guide →"}
              </Link>
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
