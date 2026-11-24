import type { Metadata } from "next";
import { Suspense } from "react";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { EvidenceHero } from "@/components/page-hero";
import {
  serverFetchEvidenceById,
  serverFetchEvidenceList,
} from "@/lib/server-api";

export const metadata: Metadata = {
  title: "Evidence Inspector",
  description:
    "Live CoinMarketCap API audit log and evidence provenance inspector across MCP, REST, and Playground calls.",
};

function EvidenceSkeleton() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading evidence records"
    >
      <div className="tg-panel h-24 animate-pulse rounded-2xl" />
      <div className="tg-panel h-80 animate-pulse rounded-2xl" />
    </div>
  );
}

async function EvidenceStream({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawId = params.id;
  const queryId =
    typeof rawId === "string"
      ? rawId.trim()
      : Array.isArray(rawId)
        ? (rawId[0]?.trim() ?? "")
        : "";

  const [listRes, detailRes] = await Promise.all([
    serverFetchEvidenceList(),
    queryId ? serverFetchEvidenceById(queryId) : Promise.resolve(null),
  ]);

  const records = listRes.ok ? listRes.data.records : [];
  const selected =
    detailRes && detailRes.ok
      ? detailRes.data
      : queryId
        ? (records.find((row) => row.evidence_id === queryId) ?? null)
        : null;

  const initialError = !listRes.ok
    ? { status: listRes.status, message: listRes.message }
    : detailRes && !detailRes.ok
      ? { status: detailRes.status, message: detailRes.message }
      : null;

  return (
    <EvidenceInspector
      initialRecords={records}
      initialSelected={selected}
      initialQueryId={queryId || null}
      initialError={initialError}
    />
  );
}

export default function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6"
    >
      <EvidenceHero />
      <Suspense fallback={<EvidenceSkeleton />}>
        <EvidenceStream searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
