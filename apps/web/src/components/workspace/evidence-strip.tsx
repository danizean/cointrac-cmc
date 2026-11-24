"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiNotice } from "@/components/api-notice";
import { useAppPreferences } from "@/components/app-preferences";
import { fetchEvidenceList } from "@/lib/api";
import { formatUtc } from "@/lib/format";
import type { EvidenceRecord } from "@/lib/types";
import { workspaceCopy } from "@/lib/workspace-copy";

export function EvidenceStrip() {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const [records, setRecords] = useState<EvidenceRecord[] | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await fetchEvidenceList();
      if (controller.signal.aborted) return;
      if (result.ok) {
        setRecords(result.data.records.slice(0, 6));
        setError(null);
      } else {
        setRecords([]);
        setError({ status: result.status, message: result.message });
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <section className="space-y-3" aria-labelledby="recent-evidence">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recent-evidence" className="text-sm font-semibold text-foreground">
          {copy.recentEvidence}
        </h2>
        <Link href="/evidence" className="text-xs font-semibold text-primary">
          {copy.next}
        </Link>
      </div>
      {error ? <ApiNotice status={error.status} message={error.message} /> : null}
      {records === null ? <div className="h-16 animate-pulse rounded-xl bg-muted" aria-busy="true" /> : null}
      {records && records.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">
          {copy.emptyEvidence} {copy.emptyEvidenceHint}
        </p>
      ) : null}
      {records && records.length > 0 ? (
        <ul className="divide-y divide-border border-y border-border">
          {records.map((record) => (
            <li key={record.evidence_id}>
              <Link
                href={`/evidence?id=${encodeURIComponent(record.evidence_id)}`}
                className="flex min-h-11 flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-mono text-xs text-foreground">{record.tool_name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {record.data_mode} · {formatUtc(record.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
