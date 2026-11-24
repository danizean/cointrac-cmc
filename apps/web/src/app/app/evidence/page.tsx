import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspaceEvidenceConsole } from "@/components/workspace/workspace-evidence-console";

export const metadata: Metadata = {
  title: "Evidence",
  description:
    "Inspect the source, timestamp, and provenance of intelligence returned by CoinTrac.",
};

function EvidenceConsoleFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading evidence console">
      <div className="h-24 animate-pulse rounded-[14px] border border-border bg-card" />
      <div className="h-64 animate-pulse rounded-[14px] border border-border bg-card" />
    </div>
  );
}

export default function AppEvidencePage() {
  return (
    <Suspense fallback={<EvidenceConsoleFallback />}>
      <WorkspaceEvidenceConsole />
    </Suspense>
  );
}
