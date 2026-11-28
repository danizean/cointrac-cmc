"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchHealth } from "@/lib/api";

type EngineConnectionState = "connecting" | "online" | "standby";

function compactVersion(raw: string | null): string | null {
  if (!raw) return null;
  const match = /v?\d+\.\d+(?:\.\d+)?/i.exec(raw);
  return match ? (match[0].startsWith("v") ? match[0] : `v${match[0]}`) : raw;
}

const STATUS_CACHE_KEY = "ct_api_status_v1";
const STATUS_CACHE_TTL_MS = 60_000;

interface CachedHealthSnapshot {
  state: Exclude<EngineConnectionState, "connecting">;
  engineVersion: string | null;
  latencyMs: number | null;
  checkedAt: number;
}

function readCachedHealth(): CachedHealthSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STATUS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedHealthSnapshot>;
    if (
      (parsed.state === "online" || parsed.state === "standby") &&
      typeof parsed.checkedAt === "number" &&
      Date.now() - parsed.checkedAt < STATUS_CACHE_TTL_MS
    ) {
      return {
        state: parsed.state,
        engineVersion: typeof parsed.engineVersion === "string" ? parsed.engineVersion : null,
        latencyMs: typeof parsed.latencyMs === "number" ? parsed.latencyMs : null,
        checkedAt: parsed.checkedAt,
      };
    }
  } catch {
    // Ignore storage quota or private browsing errors.
  }
  return null;
}

function writeCachedHealth(snapshot: CachedHealthSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage errors.
  }
}

export function EngineStatusPill({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<EngineConnectionState>("connecting");
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const checkHealth = useCallback(async (background = false) => {
    if (!background) {
      setState("connecting");
    }
    const res = await fetchHealth();
    if (res.ok && res.data?.status === "ok") {
      const ver = res.data.engine_version ?? null;
      setState("online");
      setEngineVersion(ver);
      setLatencyMs(res.latencyMs);
      writeCachedHealth({
        state: "online",
        engineVersion: ver,
        latencyMs: res.latencyMs,
        checkedAt: Date.now(),
      });
      return;
    }
    setState("standby");
    setLatencyMs(null);
    writeCachedHealth({
      state: "standby",
      engineVersion: null,
      latencyMs: null,
      checkedAt: Date.now(),
    });
  }, []);

  useEffect(() => {
    const cached = readCachedHealth();
    if (cached) {
      // Hydrate immediately from recent tab verification to avoid "Checking API..." lag.
      queueMicrotask(() => {
        setState(cached.state);
        setEngineVersion(cached.engineVersion);
        setLatencyMs(cached.latencyMs);
      });
    }

    let active = true;
    void (async () => {
      const res = await fetchHealth();
      if (!active) return;
      if (res.ok && res.data?.status === "ok") {
        const ver = res.data.engine_version ?? null;
        setState("online");
        setEngineVersion(ver);
        setLatencyMs(res.latencyMs);
        writeCachedHealth({
          state: "online",
          engineVersion: ver,
          latencyMs: res.latencyMs,
          checkedAt: Date.now(),
        });
      } else {
        setState("standby");
        writeCachedHealth({
          state: "standby",
          engineVersion: null,
          latencyMs: null,
          checkedAt: Date.now(),
        });
      }
    })();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkHealth(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkHealth]);

  const shortVer = compactVersion(engineVersion);

  const tone =
    state === "online"
      ? "border-positive/35 bg-positive-soft text-positive hover:border-positive/55"
      : state === "standby"
        ? "border-warning/40 bg-warning-soft text-warning hover:border-warning/60"
        : "border-info/35 bg-info-soft text-info";

  const fullTitle =
    state === "online"
      ? `CoinTrac API is online${engineVersion ? ` (${engineVersion})` : ""}${latencyMs !== null ? ` · ${latencyMs} ms` : ""}. Click to re-check.`
      : state === "standby"
        ? "Could not reach the CoinTrac API right now. Click to retry."
        : "Checking CoinTrac API status...";

  return (
    <button
      type="button"
      onClick={() => void checkHealth()}
      title={fullTitle}
      aria-label={fullTitle}
      className={`inline-flex min-h-11 sm:min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-tight transition-colors ${tone}`}
    >
      {state === "connecting" ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          <span className={compact ? "hidden xl:inline" : "hidden md:inline"}>
            Checking API...
          </span>
          <span className={compact ? "xl:hidden" : "md:hidden"}>Checking...</span>
        </>
      ) : state === "online" ? (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-positive" aria-hidden="true" />
          <span>API Online</span>
          {shortVer ? (
            <span className="hidden border-l border-positive/30 pl-1.5 text-foreground/85 lg:inline">
              {shortVer}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          <span>API Unavailable</span>
          <RefreshCw className="h-2.5 w-2.5 opacity-80" aria-hidden="true" />
        </>
      )}
    </button>
  );
}
