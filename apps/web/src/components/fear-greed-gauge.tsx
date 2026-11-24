import { MISSING } from "@/lib/format";

interface FearGreedGaugeProps {
  value: number | null;
  classification: string | null;
}

export function FearGreedGauge({
  value,
  classification,
}: FearGreedGaugeProps) {
  const clamped =
    value !== null && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;

  // Semi-circle path length for r=64 is PI * 64 ≈ 201.06
  const radius = 64;
  const arcLength = Math.PI * radius;
  const dashOffset =
    clamped !== null ? arcLength * (1 - clamped / 100) : arcLength;

  const toneClass =
    clamped === null
      ? "text-muted-foreground"
      : clamped <= 30
        ? "text-destructive"
        : clamped <= 55
          ? "text-accent"
          : "text-positive";

  const strokeColor =
    clamped === null
      ? "var(--muted)"
      : clamped <= 30
        ? "var(--destructive)"
        : clamped <= 55
          ? "var(--accent)"
          : "var(--positive)";

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-28 w-44">
        <svg
          viewBox="0 0 160 95"
          className="h-full w-full overflow-visible"
          role="img"
          aria-label={
            clamped !== null
              ? `Fear and Greed Index: ${Math.round(clamped)} out of 100 (${classification ?? "Unclassified"})`
              : "Fear and Greed Index unavailable"
          }
        >
          {/* Background track */}
          <path
            d="M 16 82 A 64 64 0 0 1 144 82"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* Active arc */}
          {clamped !== null && (
            <path
              d="M 16 82 A 64 64 0 0 1 144 82"
              fill="none"
              stroke={strokeColor}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={arcLength}
              strokeDashoffset={dashOffset}
            />
          )}
        </svg>

        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center text-center">
          <span
            className={`font-mono text-3xl font-bold leading-none tabular-nums ${toneClass}`}
          >
            {clamped !== null ? Math.round(clamped) : MISSING}
          </span>
          <span className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {classification ?? "Unavailable"}
          </span>
        </div>
      </div>

      <div className="mt-1 flex w-44 justify-between font-mono text-[10px] text-muted-foreground">
        <span>0 Fear</span>
        <span>50</span>
        <span>100 Greed</span>
      </div>
    </div>
  );
}
