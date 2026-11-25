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
    <div className="ct-code-swap space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Output format"
          className="inline-flex rounded-full border border-border bg-card/80 p-1"
        >
          <button
            type="button"
            aria-pressed={!raw}
            onClick={() => setRaw(false)}
            className={`min-h-8 cursor-pointer rounded-full px-3.5 font-mono text-xs font-medium transition-colors ${
              !raw
                ? "bg-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {copy.report}
          </button>
          <button
            type="button"
            aria-pressed={raw}
            onClick={() => setRaw(true)}
            className={`min-h-8 cursor-pointer rounded-full px-3.5 font-mono text-xs font-medium transition-colors ${
              raw
                ? "bg-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {copy.raw}
          </button>
        </div>

        <span className="font-mono text-[11px] text-subtle-foreground">
          {envelopes.length} {envelopes.length === 1 ? "result" : "results"}
        </span>
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
