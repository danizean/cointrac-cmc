import type { Metadata } from "next";
import { IntegrationsView } from "@/components/marketing/integrations-view";
import { PROMPT_CATALOG, RESOURCE_CATALOG } from "@/lib/catalog";
import { siteUrl } from "@/lib/site-url";

const site = siteUrl();

export const metadata: Metadata = {
  title: "MCP Integrations — ChatGPT, Claude, Gemini & Hermes",
  alternates: { canonical: "/integrations" },
  description:
    "Connect ChatGPT, Claude, Gemini, Hermes, Cursor, or Antigravity to CoinTrac's Streamable HTTP MCP server with 11 tools, 5 resources, 3 prompts, and OAuth 2.1 + PKCE.",
  keywords: [
    "CoinTrac MCP integrations",
    "Streamable HTTP MCP server",
    "ChatGPT crypto MCP",
    "Claude crypto market MCP",
    "Gemini OAuth PKCE MCP",
    "Hermes crypto MCP",
    "crypto market tools MCP",
  ],
  openGraph: {
    title: "CoinTrac MCP Integrations — 11 Tools, 5 Resources & 3 Prompts",
    description:
      "Connect AI assistants over HTTPS Streamable HTTP or local stdio using API key or OAuth 2.1 Authorization Code + PKCE.",
    url: new URL("/integrations", site),
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac MCP Integrations",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinTrac MCP Integrations — ChatGPT, Claude, Gemini & Hermes",
    description:
      "Connect AI assistants to deterministic CoinMarketCap intelligence over Streamable HTTP MCP.",
    images: ["/brand/cointrac-logo.png"],
  },
};

export default function IntegrationsPage() {
  const origin = site.origin;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${origin}/integrations#webpage`,
        url: `${origin}/integrations`,
        name: "CoinTrac MCP Integrations",
        isPartOf: { "@id": `${origin}/#website` },
        description:
          "Streamable HTTP MCP integration catalog for ChatGPT, Claude, Gemini, and Hermes with 11 tools, 5 resources, and 3 prompts.",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: origin },
          { "@type": "ListItem", position: 2, name: "MCP Integrations", item: `${origin}/integrations` },
        ],
      },
      {
        "@type": "ItemList",
        name: "CoinTrac MCP Resources and Prompts",
        numberOfItems: RESOURCE_CATALOG.length + PROMPT_CATALOG.length,
        itemListElement: [
          ...RESOURCE_CATALOG.map((res, idx) => ({
            "@type": "ListItem",
            position: idx + 1,
            name: res.uri,
            description: res.description,
          })),
          ...PROMPT_CATALOG.map((prompt, idx) => ({
            "@type": "ListItem",
            position: RESOURCE_CATALOG.length + idx + 1,
            name: prompt.name,
            description: prompt.description,
          })),
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
      <IntegrationsView />
    </>
  );
}
