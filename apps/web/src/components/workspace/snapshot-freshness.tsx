"use client";

import { Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";

type SnapshotNotice = {
  cadence_seconds?: number;
};

type StreamListener = {
  onCadence: (seconds: number) => void;
  onManual: () => void;
  onSnapshot: () => void;
};

const streamListeners = new Set<StreamListener>();
let streamController: AbortController | null = null;
let streamStopTimer: ReturnType<typeof setTimeout> | null = null;

function notifyManual() {
  for (const listener of streamListeners) listener.onManual();
}

async function readSharedStream(active: AbortController) {
  try {
    const response = await fetch("/api/cointrac/v1/intelligence/stream", {
      credentials: "include",
      signal: active.signal,
      headers: { accept: "text/event-stream" },
    });
    if (!response.ok || !response.body) {
      if (!active.signal.aborted) notifyManual();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!active.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        let payload: SnapshotNotice;
        try {
          payload = JSON.parse(dataLine.slice(6)) as SnapshotNotice;
        } catch {
          continue;
        }
        if (typeof payload.cadence_seconds !== "number") continue;
        for (const listener of streamListeners) {
          listener.onCadence(payload.cadence_seconds);
          listener.onSnapshot();
        }
      }
    }
    if (!active.signal.aborted) notifyManual();
  } catch {
    if (!active.signal.aborted) notifyManual();
  } finally {
    if (streamController === active) streamController = null;
  }
}

function subscribeToSnapshotStream(listener: StreamListener) {
  streamListeners.add(listener);
  if (streamStopTimer) {
    clearTimeout(streamStopTimer);
    streamStopTimer = null;
  }
  if (!streamController) {
    streamController = new AbortController();
    void readSharedStream(streamController);
  }
  return () => {
    streamListeners.delete(listener);
    if (streamListeners.size > 0) return;
    streamStopTimer = setTimeout(() => {
      streamStopTimer = null;
      if (streamListeners.size === 0) {
        streamController?.abort();
        streamController = null;
      }
    }, 400);
  };
}

export function SnapshotFreshness({ onSnapshot }: { onSnapshot?: () => void }) {
  const { locale } = useAppPreferences();
  const refresh = useRef(onSnapshot);
  const [cadence, setCadence] = useState<number | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    refresh.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    return subscribeToSnapshotStream({
      onCadence: (seconds) => {
        setCadence(seconds);
        setManual(false);
      },
      onManual: () => setManual(true),
      onSnapshot: () => refresh.current?.(),
    });
  }, []);

  const label =
    cadence === null
      ? null
      : locale === "id"
        ? `SSE aktif · ±${cadence} dtk`
        : `SSE stream · ±${cadence}s`;

  const tone = manual
    ? "border-border bg-card text-muted-foreground"
    : cadence !== null
      ? "border-positive/35 bg-positive-soft text-positive"
      : "border-info/35 bg-info-soft text-info";

  return (
    <span
      role="status"
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-medium ${tone}`}
    >
      <Radio className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {manual
          ? locale === "id"
            ? "Snapshot manual"
            : "Manual refresh mode"
          : (label ??
            (locale === "id"
              ? "Menunggu snapshot..."
              : "Awaiting cached snapshot..."))}
      </span>
    </span>
  );
}
