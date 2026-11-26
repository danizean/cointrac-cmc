import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaygroundHero } from "@/components/page-hero";
import { PlaygroundConsole } from "@/components/playground-console";
import { TOOL_CATALOG } from "@/lib/catalog";
import { siteUrl } from "@/lib/site-url";
import { getVerifiedServerIdentity } from "@/lib/supabase/server";

const site = siteUrl();

export const metadata: Metadata = {
  title: "Interactive MCP & API Playground — Live Tools & Schema Explorer",
  alternates: { canonical: "/playground" },
  description:
    "Explore interactive sample schemas and execute all 10 CoinTrac crypto intelligence tools and 4 presets live with EvidenceEnvelope[T] visual reports, JSON, audit provenance, cURL, MCP, and Python snippets.",
  keywords: [
    "CoinTrac Playground",
    "crypto intelligence MCP playground",
    "EvidenceEnvelope explorer",
    "CoinMarketCap MCP sandbox",
    "anti-chase crypto screener tool",
    "market regime classifier demo",
  ],
  openGraph: {
    title: "CoinTrac Interactive Playground — Live Tools & Schema Explorer",
    description:
      "Inspect formatted reports, raw EvidenceEnvelope JSON, audit provenance, and ready-to-run cURL/MCP/Python snippets for all 10 CoinTrac tools.",
    url: new URL("/playground", site),
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac Interactive MCP & API Playground",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinTrac Interactive MCP & API Playground",
    description:
      "Inspect sample EvidenceEnvelope outputs or run all 10 CoinTrac intelligence tools live.",
    images: ["/brand/cointrac-logo.png"],
  },
};

async function PlaygroundWithSession() {
  const { user, emailVerified } = await getVerifiedServerIdentity();
  return (
    <PlaygroundConsole
      initialAuthenticated={Boolean(user && emailVerified)}
      initialEmail={user?.email ?? null}
    />
  );
}

export default function PlaygroundPage() {
  const origin = site.origin;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${origin}/playground#webpage`,
        url: `${origin}/playground`,
        name: "CoinTrac Interactive MCP & API Playground",
        isPartOf: { "@id": `${origin}/#website` },
        description:
          "Interactive developer studio to explore illustrative sample EvidenceEnvelope schemas and run all 10 CoinTrac intelligence tools.",
      },
      {
        "@type": "SoftwareApplication",
        name: "CoinTrac Intelligence Playground",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        url: `${origin}/playground`,
        featureList: TOOL_CATALOG.map((tool) => `${tool.name} (${tool.method})`),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: origin },
          {
            "@type": "ListItem",
            position: 2,
            name: "Playground",
            item: `${origin}/playground`,
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
      <PlaygroundHero />
      <div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <Suspense fallback={<PlaygroundConsole />}>
          <PlaygroundWithSession />
        </Suspense>
      </div>
    </main>
  );
}
