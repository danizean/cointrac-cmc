"use client";

import { formatPct } from "@/lib/format";
import type { SectorSnapshot } from "@/lib/types";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAppPreferences } from "./app-preferences";

interface SectorRotationChartProps {
  sectors: SectorSnapshot[];
}

type MetricKey =
  | "median_change_7d_pct"
  | "median_change_24h_pct"
  | "cap_weighted_change_7d_pct";

export function SectorRotationChart({ sectors }: SectorRotationChartProps) {
  const { t } = useAppPreferences();
  const [metric, setMetric] = useState<MetricKey>("median_change_7d_pct");

  const metricLabels: Record<MetricKey, string> = {
    median_change_7d_pct: t.overview.colMedian7d,
    median_change_24h_pct: t.overview.colMedian24h,
    cap_weighted_change_7d_pct: t.overview.colCapWtd7d,
  };

  const chartData = sectors
    .filter(
      (sector) =>
        typeof sector[metric] === "number" && Number.isFinite(sector[metric]),
    )
    .map((sector) => ({
      slug: sector.sector_slug,
      name: sector.display_name,
      value: sector[metric] as number,
      label: formatPct(sector[metric], { signed: true, decimals: 1 }),
      isRwa: sector.sector_slug === "rwa",
      constituents: sector.constituent_count,
    }))
    .sort((a, b) => b.value - a.value);

  const leader = chartData[0] ?? null;
  const rwa = chartData.find((item) => item.isRwa) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="h-2.5 w-2.5 rounded-full bg-positive" />
            {t.overview.positive}
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
            {t.overview.rwaSpotlight}
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
            {t.overview.negative}
          </span>
        </div>

        <div
          role="group"
          aria-label="Sector metric selector"
          className="inline-flex rounded-full border border-border bg-card-elevated p-1"
        >
          {(Object.keys(metricLabels) as MetricKey[]).map((key) => {
            const active = metric === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setMetric(key)}
                className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition-all duration-200 ${
                  active
                    ? "bg-foreground text-background shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {metricLabels[key]}
              </button>
            );
          })}
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex h-60 items-center justify-center rounded-xl border border-dashed border-border bg-card-elevated/60 p-4 text-center text-sm text-muted-foreground">
          {t.overview.noSectorData}
        </div>
      ) : (
        <>
          <div className="h-68 w-full min-w-0 rounded-xl border border-border bg-card-elevated/55 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 24, right: 14, left: -12, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 4"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine
                  y={0}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.45}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.45 }}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    borderColor: "var(--border)",
                    borderRadius: "10px",
                    color: "var(--card-foreground)",
                    fontSize: "12px",
                    fontFamily: "var(--font-jetbrains), monospace",
                    boxShadow: "var(--shadow-md)",
                  }}
                  formatter={(value) => [
                    formatPct(typeof value === "number" ? value : null, {
                      signed: true,
                    }),
                    metricLabels[metric],
                  ]}
                />
                <Bar dataKey="value" radius={[6, 6, 4, 4]} maxBarSize={48}>
                  <LabelList
                    dataKey="label"
                    position="top"
                    fill="var(--foreground)"
                    fontSize={11}
                    fontFamily="var(--font-jetbrains), monospace"
                  />
                  {chartData.map((entry) => {
                    const fill = entry.isRwa
                      ? "var(--accent)"
                      : entry.value >= 0
                        ? "var(--positive)"
                        : "var(--destructive)";
                    return <Cell key={entry.slug} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div
            role="status"
            aria-atomic="true"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card-elevated/70 px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground"
          >
            <span>
              {t.overview.rankedBy}{" "}
              <strong className="text-foreground">{metricLabels[metric]}</strong>
              {leader ? (
                <>
                  {" "}
                  · {t.overview.topSector}:{" "}
                  <strong className="text-foreground">
                    {leader.name} ({leader.label})
                  </strong>
                </>
              ) : null}
            </span>
            {rwa && (
              <span className="inline-flex items-center gap-1.5 text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                RWA: <strong>{rwa.label}</strong> ({rwa.constituents})
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
