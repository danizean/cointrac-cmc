export const KNOWN_BUDGET_STATES = [
  "NORMAL",
  "ELEVATED",
  "CONSERVATION",
  "EMERGENCY",
  "CUTOFF",
] as const;

export type KnownBudgetState = (typeof KNOWN_BUDGET_STATES)[number];

export type BudgetTone = "positive" | "info" | "warning" | "destructive" | "neutral";

export type BudgetPresentation = {
  code: KnownBudgetState | "UNKNOWN" | "UNSET";
  label: string;
  description: string;
  tone: BudgetTone;
  visual: KnownBudgetState | "unknown";
};

const PRESENTATION: Record<KnownBudgetState, Omit<BudgetPresentation, "code" | "visual">> = {
  NORMAL: {
    label: "NORMAL",
    description: "The usage API reported budget state NORMAL.",
    tone: "positive",
  },
  ELEVATED: {
    label: "ELEVATED",
    description:
      "The usage API reported ELEVATED. In the ledger this is the warning that accompanies budget state NORMAL, not a separate cutoff.",
    tone: "info",
  },
  CONSERVATION: {
    label: "CONSERVATION",
    description:
      "The usage API reported CONSERVATION. Expensive server-key calls are denied while this state is in effect.",
    tone: "warning",
  },
  EMERGENCY: {
    label: "EMERGENCY",
    description:
      "The usage API reported EMERGENCY. Server-key calls are limited to core warmer cache misses.",
    tone: "destructive",
  },
  CUTOFF: {
    label: "CUTOFF",
    description: "The usage API reported CUTOFF. New server-key upstream calls are denied.",
    tone: "destructive",
  },
};

export function presentBudgetState(raw: string | null | undefined): BudgetPresentation {
  const normalized = raw?.trim().toUpperCase() ?? "";
  if (!normalized) {
    return {
      code: "UNSET",
      label: "—",
      description: "Budget state was not included in the usage payload.",
      tone: "neutral",
      visual: "unknown",
    };
  }
  if ((KNOWN_BUDGET_STATES as readonly string[]).includes(normalized)) {
    const code = normalized as KnownBudgetState;
    return { code, visual: code, ...PRESENTATION[code] };
  }
  return {
    code: "UNKNOWN",
    label: "UNKNOWN",
    description: `The usage API reported "${raw?.trim()}", which this console does not recognize.`,
    tone: "neutral",
    visual: "unknown",
  };
}
