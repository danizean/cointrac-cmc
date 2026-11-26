import type { Metadata } from "next";
import { Suspense } from "react";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { EvidenceHero } from "@/components/page-hero";
import {
  serverFetchEvidenceById,
  serverFetchEvidenceList,
} from "@/lib/server-api";
import { siteUrl } from "@/lib/site-url";

const site = siteUrl();

export const metadata: Metadata = {
  title: "Evidence Provenance Inspector — Audited Tool & API Logs",
  alternates: { canonical: "/evidence" },
  description:
    "Inspect persisted CoinTrac EvidenceEnvelope audit records across MCP, REST, and Playground calls with UTC timestamps, CMC endpoints, credit costs, and null-safe data modes.",
  keywords: [
    "CoinTrac Evidence Inspector",
    "EvidenceEnvelope audit log",
    "crypto API provenance",
    "CoinMarketCap credit tracking",
    "MCP tool audit trail",
  ],
  openGraph: {
    title: "CoinTrac Evidence Provenance Inspector",
    description:
      "Search and audit persisted EvidenceEnvelope records across MCP, REST, and Playground executions.",
    url: new URL("/evidence", site),
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac Evidence Provenance Inspector",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinTrac Evidence Provenance Inspector",
    description:
      "Audit UTC timestamps, CoinMarketCap endpoints, data modes, and recorded limitations.",
    images: ["/brand/cointrac-logo.png"],
  },
};

function EvidenceSkeleton() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading evidence records"
    >
      <div className="ct-surface-featured h-32 animate-pulse rounded-[18px]" />
      <div className="ct-surface-card h-80 animate-pulse rounded-[18px]" />
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
  const origin = site.origin;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${origin}/evidence#webpage`,
        url: `${origin}/evidence`,
        name: "CoinTrac Evidence Provenance Inspector",
        isPartOf: { "@id": `${origin}/#website` },
        description:
          "Audit persisted CoinTrac EvidenceEnvelope logs across MCP, REST, and Playground calls.",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: origin },
          {
            "@type": "ListItem",
            position: 2,
            name: "Evidence Inspector",
            item: `${origin}/evidence`,
          },
        ],
      },
    ],
  };

  return (
    <main id="content" className="relative overflow-x-clip">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <EvidenceHero />
      <div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <Suspense fallback={<EvidenceSkeleton />}>
          <EvidenceStream searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
