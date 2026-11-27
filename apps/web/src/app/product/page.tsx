import type { Metadata } from "next";
import { CapabilitiesView } from "@/components/marketing/capabilities-view";
import { TOOL_CATALOG } from "@/lib/catalog";
import { siteUrl } from "@/lib/site-url";

const site = siteUrl();

export const metadata: Metadata = {
  title: "Product & Capabilities — Crypto REST Endpoints, Hidden Gems & MCP",
  alternates: { canonical: "/product" },
  description:
    "Explore CoinTrac's 10 deterministic crypto market intelligence REST endpoints, 14 MCP tools, Hidden Gem Discovery Engine, and transparent TIER_RESTRICTED status reporting.",
  keywords: [
    "crypto intelligence API endpoints",
    "CoinMarketCap MCP tools",
    "hidden gem crypto discovery API",
    "market regime classification API",
    "crypto sector rotation API",
    "EvidenceEnvelope status modes",
  ],
  openGraph: {
    title: "CoinTrac Product & Capabilities — 10 REST Tools, Hidden Gems & 14 MCP Tools",
    description:
      "Full reference of CoinTrac intelligence endpoints, deterministic scoring formulas, status flags (OK, PARTIAL, TIER_RESTRICTED, INSUFFICIENT_DATA), and MCP contracts.",
    url: new URL("/product", site),
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac Product & Capabilities",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinTrac Product & Capabilities — REST API, Hidden Gems & MCP",
    description:
      "Ten deterministic intelligence tools, Hidden Gem Discovery Engine, and 14 MCP tools with audited evidence envelopes.",
    images: ["/brand/cointrac-logo.png"],
  },
};

export default function ProductPage() {
  const origin = site.origin;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${origin}/product#webpage`,
        url: `${origin}/product`,
        name: "CoinTrac Product & Capabilities",
        isPartOf: { "@id": `${origin}/#website` },
        description:
          "Catalog of CoinTrac's 10 deterministic market intelligence REST endpoints, Hidden Gem Discovery Engine, and 14 MCP tools.",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: origin },
          { "@type": "ListItem", position: 2, name: "Product & Capabilities", item: `${origin}/product` },
        ],
      },
      {
        "@type": "ItemList",
        name: "CoinTrac Intelligence Tool Catalog",
        numberOfItems: TOOL_CATALOG.length,
        itemListElement: TOOL_CATALOG.map((tool, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: `${tool.label} (${tool.method} ${tool.restPath})`,
          description: tool.summary,
        })),
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
      <CapabilitiesView />
    </>
  );
}
