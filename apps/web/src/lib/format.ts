export const MISSING = "—";
export const UNAVAILABLE = "Unavailable";

export function unavailableLabel(locale: "en" | "id" = "en"): string {
  return locale === "id" ? "Tidak tersedia" : "Unavailable";
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const CURRENCY_PREFIXES: Record<string, string> = {
  USD: "$",
  USDT: "$",
  USDC: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  BTC: "₿",
  ETH: "Ξ",
  IDR: "Rp ",
  SGD: "S$",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF ",
};

function normalizeCurrencyCode(currency: string | null | undefined): string {
  const cleaned = currency?.trim().toUpperCase();
  return cleaned && cleaned.length > 0 ? cleaned : "USD";
}

export function formatQuoteCurrency(
  value: number | null | undefined,
  currency: string | null | undefined = "USD"
): string {
  if (!isFiniteNumber(value)) return MISSING;
  const code = normalizeCurrencyCode(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (code === "BTC" || code === "ETH") {
    const decimals = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
    const prefix = CURRENCY_PREFIXES[code] ?? `${code} `;
    return `${sign}${prefix}${abs.toLocaleString("en-US", {
      minimumFractionDigits: abs >= 1 ? 2 : 4,
      maximumFractionDigits: decimals,
    })}`;
  }

  const maximumFractionDigits = abs >= 100 ? 2 : abs >= 1 ? 3 : 6;
  const minimumFractionDigits = code === "JPY" || code === "IDR" ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits,
      maximumFractionDigits: Math.max(minimumFractionDigits, maximumFractionDigits),
    }).format(value);
  } catch {
    const prefix = CURRENCY_PREFIXES[code] ?? `${code} `;
    return `${sign}${prefix}${abs.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits,
    })}`;
  }
}

export function formatCompactQuoteCurrency(
  value: number | null | undefined,
  currency: string | null | undefined = "USD"
): string {
  if (!isFiniteNumber(value)) return MISSING;
  const code = normalizeCurrencyCode(currency);
  const prefix = CURRENCY_PREFIXES[code] ?? `${code} `;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${prefix}${(abs / 1_000).toFixed(2)}K`;
  }
  if (code === "BTC" || code === "ETH") {
    return `${sign}${prefix}${abs.toFixed(abs >= 1 ? 2 : 4)}`;
  }
  return `${sign}${prefix}${abs.toFixed(2)}`;
}

export function formatUsd(value: number | null | undefined): string {
  return formatQuoteCurrency(value, "USD");
}

export function formatCompactUsd(value: number | null | undefined): string {
  return formatCompactQuoteCurrency(value, "USD");
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
