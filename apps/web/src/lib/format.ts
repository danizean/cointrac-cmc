export const MISSING = "—";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatUsd(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return MISSING;
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 100 ? 2 : abs >= 1 ? 3 : 6;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}

export function formatCompactUsd(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return MISSING;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatPct(
  value: number | null | undefined,
  options?: { signed?: boolean; decimals?: number },
): string {
  if (!isFiniteNumber(value)) return MISSING;
  const decimals = options?.decimals ?? 2;
  const sign = options?.signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatNumber(
  value: number | null | undefined,
  decimals = 2,
): string {
  if (!isFiniteNumber(value)) return MISSING;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals > 0 ? Math.min(decimals, 2) : 0,
  }).format(value);
}

export function formatInteger(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return MISSING;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatRatio(
  value: number | null | undefined,
  decimals = 4,
): string {
  if (!isFiniteNumber(value)) return MISSING;
  return value.toFixed(decimals);
}

export function formatUtc(timestamp: string | null | undefined): string {
  if (!timestamp) return MISSING;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function formatDurationMs(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return MISSING;
  return `${Math.round(value)} ms`;
}

export function pctToneClass(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "text-muted-foreground";
  if (value > 0) return "text-positive";
  if (value < 0) return "text-destructive";
  return "text-muted-foreground";
}
