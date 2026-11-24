"use client";

import { useState } from "react";
import { EnvelopeFormattedReport } from "@/components/envelope-report";
import { JsonViewer } from "@/components/json-viewer";
import { useAppPreferences } from "@/components/app-preferences";
import type { EvidenceEnvelope } from "@/lib/types";
import { workspaceCopy } from "@/lib/workspace-copy";

export function ResultStack({ envelopes }: { envelopes: EvidenceEnvelope[] }) {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const [raw, setRaw] = useState(false);

  if (envelopes.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={!raw}
          onClick={() => setRaw(false)}
          className={`min-h-10 px-3 text-xs font-semibold ${raw ? "text-muted-foreground" : "text-foreground"}`}
        >
          {copy.report}
        </button>
        <button
          type="button"
          aria-pressed={raw}
          onClick={() => setRaw(true)}
          className={`min-h-10 px-3 text-xs font-semibold ${raw ? "text-foreground" : "text-muted-foreground"}`}
        >
          {copy.raw}
        </button>
      </div>
      {raw
        ? envelopes.map((envelope) => (
            <JsonViewer
              key={`${envelope.tool}-${envelope.evidence.evidence_id}`}
              value={envelope}
              title={envelope.tool}
              maxHeightClass="max-h-[32rem]"
            />
          ))
        : envelopes.map((envelope) => (
            <EnvelopeFormattedReport
              key={`${envelope.tool}-${envelope.evidence.evidence_id}`}
              envelope={envelope}
            />
          ))}
    </div>
  );
}
