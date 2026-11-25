import { Loader2 } from "lucide-react";
import { presentBudgetState } from "@/lib/budget-state";
import type {
  AnomalyDirection,
  DataMode,
  EvidenceStatus,
  Freshness,
  MultiHorizonRisk,
  RegimeLabel,
  RotationSignal,
} from "@/lib/types";

const BASE =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-tight";

function IndicatorDot({ className }: { className: string }) {
  return (
    <span
      className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${className}`}
      aria-hidden="true"
    />
  );
}

export type SystemStatusState =
  | "LIVE"
  | "CACHED"
  | "SNAPSHOT"
  | "TIER_RESTRICTED"
  | "CONNECTED"
  | "CONNECTING"
  | "STANDBY"
  | "DISCONNECTED"
  | "CONFIGURED"
  | "NOT_CONFIGURED"
  | "NOT_DEPLOYED"
  | "UNVERIFIED"
  | "ERROR"
  | "LOADING";

const SYSTEM_STATUS_CONFIG: Record<
  SystemStatusState,
  { label: string; tone: string; dot: string }
> = {
  LIVE: {
    label: "LIVE",
    tone: "border-positive/35 bg-positive-soft text-positive",
    dot: "bg-positive",
  },
  CACHED: {
    label: "CACHED",
    tone: "border-info/35 bg-info-soft text-info",
    dot: "bg-info",
  },
  SNAPSHOT: {
    label: "SNAPSHOT",
    tone: "border-warning/40 bg-warning-soft text-warning",
    dot: "bg-warning",
  },
  TIER_RESTRICTED: {
    label: "TIER RESTRICTED",
    tone: "border-warning/40 bg-warning-soft text-warning",
    dot: "bg-warning",
  },
  CONNECTED: {
    label: "CONNECTED",
    tone: "border-positive/35 bg-positive-soft text-positive",
    dot: "bg-positive",
  },
  CONNECTING: {
    label: "Connecting to Intelligence Engine...",
    tone: "border-info/35 bg-info-soft text-info",
    dot: "bg-info",
  },
  STANDBY: {
    label: "Engine Standby",
    tone: "border-warning/40 bg-warning-soft text-warning",
    dot: "bg-warning",
  },
  DISCONNECTED: {
    label: "DISCONNECTED",
    tone: "border-destructive/40 bg-destructive-soft text-destructive",
    dot: "bg-destructive",
  },
  CONFIGURED: {
    label: "CONFIGURED",
    tone: "border-primary/35 bg-primary/12 text-link",
    dot: "bg-primary",
  },
  NOT_CONFIGURED: {
    label: "NOT CONFIGURED",
    tone: "border-border bg-muted text-muted-foreground",
    dot: "bg-subtle-foreground",
  },
  NOT_DEPLOYED: {
    label: "NOT DEPLOYED",
    tone: "border-warning/40 bg-warning-soft text-warning",
    dot: "bg-warning",
  },
  UNVERIFIED: {
    label: "UNVERIFIED",
    tone: "border-border bg-muted text-muted-foreground",
    dot: "bg-subtle-foreground",
  },
  ERROR: {
    label: "ERROR",
    tone: "border-destructive/40 bg-destructive-soft text-destructive",
    dot: "bg-destructive",
  },
  LOADING: {
    label: "CHECKING",
    tone: "border-border bg-muted text-muted-foreground",
    dot: "bg-subtle-foreground",
  },
};

export function StatusIndicator({
  state,
  label,
}: {
  state: SystemStatusState;
  label?: string;
}) {
  const cfg = SYSTEM_STATUS_CONFIG[state];
  return (
    <span className={`${BASE} ${cfg.tone}`}>
      {state === "LOADING" || state === "CONNECTING" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <IndicatorDot className={cfg.dot} />
      )}
      <span>{label ?? cfg.label}</span>
    </span>
  );
}

export function BudgetStateBadge({ state }: { state: string | null | undefined }) {
  const presented = presentBudgetState(state);
  const tone =
    presented.visual === "NORMAL"
      ? "border-positive/35 bg-positive-soft text-positive"
      : presented.visual === "ELEVATED"
        ? "border-info/40 bg-info-soft text-info"
        : presented.visual === "CONSERVATION"
          ? "border-warning/40 bg-warning-soft text-warning"
          : presented.visual === "EMERGENCY"
            ? "border-destructive/35 bg-destructive-soft text-destructive"
            : presented.visual === "CUTOFF"
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "border-border bg-muted text-muted-foreground";
  const dot =
    presented.visual === "NORMAL"
      ? "bg-positive"
      : presented.visual === "ELEVATED"
        ? "bg-info"
        : presented.visual === "CONSERVATION"
          ? "bg-warning"
          : presented.visual === "EMERGENCY" || presented.visual === "CUTOFF"
            ? "bg-destructive"
            : "bg-subtle-foreground";

  return (
    <span className={`${BASE} ${tone}`}>
      <IndicatorDot className={presented.code === "UNSET" ? "bg-transparent" : dot} />
      <span>{presented.label}</span>
    </span>
  );
}

export function QuotaProfileBadge({ profile }: { profile: string | null | undefined }) {
  if (!profile) {
    return (
      <span className={`${BASE} border-border bg-muted text-muted-foreground`}>
        —
      </span>
    );
  }
  const normalized = profile.toLowerCase();
  const tone =
    normalized === "startup"
      ? "border-primary/35 bg-primary/12 text-link"
      : normalized === "basic"
        ? "border-info/35 bg-info-soft text-info"
        : "border-border bg-muted text-foreground";

  return (
    <span className={`${BASE} ${tone}`}>
      <span>{normalized.toUpperCase()} PROFILE</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: EvidenceStatus | string }) {
  const tone =
    status === "OK"
      ? "border-positive/35 bg-positive-soft text-positive"
      : status === "PARTIAL" || status === "TIER_RESTRICTED"
        ? "border-warning/40 bg-warning-soft text-warning"
        : "border-destructive/40 bg-destructive-soft text-destructive";

  const dot =
    status === "OK"
      ? "bg-positive"
      : status === "PARTIAL" || status === "TIER_RESTRICTED"
        ? "bg-warning"
        : "bg-destructive";

  return (
    <span className={`${BASE} ${tone}`}>
      <IndicatorDot className={dot} />
      <span>{status.replaceAll("_", " ")}</span>
    </span>
  );
}

export function DataModeBadge({ mode }: { mode: DataMode | string | null }) {
  if (!mode) {
    return <StatusIndicator state="DISCONNECTED" label="OFFLINE" />;
  }
  if (mode === "LIVE") {
    return <StatusIndicator state="LIVE" />;
  }
  if (mode === "CACHED") {
    return <StatusIndicator state="CACHED" />;
  }
  if (mode === "UNAVAILABLE") {
    return <StatusIndicator state="ERROR" label="UNAVAILABLE" />;
  }
  return <StatusIndicator state="SNAPSHOT" label="SNAPSHOT FALLBACK" />;
}

export function FreshnessBadge({
  freshness,
}: {
  freshness: Freshness | string | null;
}) {
  if (!freshness) {
    return (
      <span className={`${BASE} border-border bg-muted text-muted-foreground`}>
        —
      </span>
    );
  }
  const tone =
    freshness === "FRESH"
      ? "border-positive/35 bg-positive-soft text-positive"
      : freshness === "AGING"
        ? "border-warning/40 bg-warning-soft text-warning"
        : "border-destructive/40 bg-destructive-soft text-destructive";

  return <span className={`${BASE} ${tone}`}>{freshness}</span>;
}

export function RegimeBadge({ regime }: { regime: RegimeLabel | null }) {
  if (!regime) {
    return (
      <span className={`${BASE} border-border bg-muted text-muted-foreground`}>
        UNDETERMINED
      </span>
    );
  }
  const styles: Record<RegimeLabel, string> = {
    RISK_ON_ALTSEASON: "border-positive/35 bg-positive-soft text-positive",
    BTC_LED_EXPANSION: "border-primary/35 bg-primary/12 text-link",
    RANGE_CONSOLIDATION: "border-warning/40 bg-warning-soft text-warning",
    RISK_OFF_STRESS: "border-destructive/40 bg-destructive-soft text-destructive",
  };
  const dot: Record<RegimeLabel, string> = {
    RISK_ON_ALTSEASON: "bg-positive",
    BTC_LED_EXPANSION: "bg-primary",
    RANGE_CONSOLIDATION: "bg-warning",
    RISK_OFF_STRESS: "bg-destructive",
  };
  return (
    <span className={`${BASE} ${styles[regime]}`}>
      <IndicatorDot className={dot[regime]} />
      <span>{regime.replaceAll("_", " ")}</span>
    </span>
  );
}

export function RotationBadge({
  signal,
}: {
  signal: RotationSignal | null;
}) {
  if (!signal) {
    return (
      <span className={`${BASE} border-border bg-muted text-muted-foreground`}>
        —
      </span>
    );
  }
  const styles: Record<RotationSignal, string> = {
    LEADING: "border-positive/35 bg-positive-soft text-positive",
    GAINING_MOMENTUM: "border-primary/35 bg-primary/12 text-link",
    WEAKENING: "border-warning/40 bg-warning-soft text-warning",
    LAGGING: "border-destructive/40 bg-destructive-soft text-destructive",
    NEUTRAL: "border-border bg-muted text-muted-foreground",
    INSUFFICIENT_DATA: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span className={`${BASE} ${styles[signal]}`}>
      {signal.replaceAll("_", " ")}
    </span>
  );
}

export function MultiHorizonRiskBadge({
  risk,
}: {
  risk: MultiHorizonRisk | null | undefined;
}) {
  if (!risk) {
    return (
      <span className={`${BASE} border-border bg-muted text-muted-foreground`}>
        —
      </span>
    );
  }
  const styles: Record<MultiHorizonRisk, string> = {
    RECENT_MOMENTUM: "border-primary/35 bg-primary/12 text-link",
    EXTENDED_RALLY: "border-warning/40 bg-warning-soft text-warning",
    SHARP_RETRACEMENT: "border-destructive/40 bg-destructive-soft text-destructive",
    POTENTIAL_EXHAUSTION: "border-warning/40 bg-warning-soft text-warning",
    NEUTRAL: "border-border bg-muted text-muted-foreground",
    INSUFFICIENT_HISTORY: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span className={`${BASE} ${styles[risk]}`}>
      {risk.replaceAll("_", " ")}
    </span>
  );
}

export function AnomalyDirectionBadge({
  direction,
}: {
  direction: AnomalyDirection | null | undefined;
}) {
  if (!direction) {
    return (
      <span className={`${BASE} border-border bg-muted text-muted-foreground`}>
        —
      </span>
    );
  }
  const styles: Record<AnomalyDirection, string> = {
    HIGH_VOLUME_TO_MCAP: "border-primary/35 bg-primary/12 text-link",
    LOW_VOLUME_ILLIQUIDITY: "border-warning/40 bg-warning-soft text-warning",
    INSUFFICIENT_DATA: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span className={`${BASE} ${styles[direction]}`}>
      {direction.replaceAll("_", " ")}
    </span>
  );
}
