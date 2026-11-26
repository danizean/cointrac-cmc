import type { Metadata } from "next";
import { DocsView } from "@/components/marketing/docs-view";
import { TOOL_CATALOG } from "@/lib/catalog";
import { siteUrl } from "@/lib/site-url";

const site = siteUrl();

export const metadata: Metadata = {
  title: "API & MCP Documentation — REST Reference, Hidden Gems & Auth",
  alternates: { canonical: "/docs" },
  description:
    "Developer documentation for CoinTrac REST API endpoints, Hidden Gem Discovery Engine routes, 11 MCP tools, x-cointrac-key authentication, OAuth 2.1 + PKCE, and EvidenceEnvelope[T].",
  keywords: [
    "CoinTrac API documentation",
    "crypto intelligence REST API",
    "Hidden Gem Discovery REST API",
    "EvidenceEnvelope specification",
    "MCP OAuth 2.1 PKCE docs",
    "x-cointrac-key authentication",
  ],
  openGraph: {
    title: "CoinTrac API & MCP Documentation — REST Reference & Guides",
    description:
      "Full reference for CoinTrac /v1/intelligence/*, /v1/hidden-gems/*, authentication headers, and Streamable HTTP MCP.",
    url: new URL("/docs", site),
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac API & MCP Documentation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinTrac API & MCP Documentation",
    description:
      "REST endpoints, Hidden Gem Discovery routes, EvidenceEnvelope contracts, and MCP client guides.",
    images: ["/brand/cointrac-logo.png"],
  },
};

export default function DocsPage() {
  const origin = site.origin;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${origin}/docs#article`,
        headline: "CoinTrac API & MCP Developer Documentation",
        url: `${origin}/docs`,
        isPartOf: { "@id": `${origin}/#website` },
        author: { "@id": `${origin}/#organization` },
        description:
          "REST endpoint reference for /v1/intelligence/*, /v1/hidden-gems/*, authentication headers, and Streamable HTTP MCP integration.",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: origin },
          { "@type": "ListItem", position: 2, name: "API & MCP Docs", item: `${origin}/docs` },
        ],
      },
      {
        "@type": "ItemList",
        name: "CoinTrac REST API Endpoints",
        numberOfItems: TOOL_CATALOG.length + 1,
        itemListElement: [
          ...TOOL_CATALOG.map((tool, idx) => ({
            "@type": "ListItem",
            position: idx + 1,
            name: `${tool.method} ${tool.restPath}`,
            description: tool.summary,
          })),
          {
            "@type": "ListItem",
            position: TOOL_CATALOG.length + 1,
            name: "POST /v1/hidden-gems/scans",
            description: "Enqueue deterministic Hidden Gem Discovery scan with Idempotency-Key support.",
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <DocsView />
    </>
  );
}
