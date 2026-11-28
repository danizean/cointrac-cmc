import type { Metadata } from "next";
import { ConnectView } from "@/components/connect-view";
import { publicMcpUrl, publicOpenApiDocsUrl } from "@/lib/catalog";
import { siteUrl } from "@/lib/site-url";

const site = siteUrl();

export const metadata: Metadata = {
  title: "Connect MCP — Setup ChatGPT, Claude, Gemini & Hermes",
  alternates: { canonical: "/connect" },
  description:
    "Connect ChatGPT, Claude, Gemini, Hermes, Python, or cURL to CoinTrac Streamable HTTP MCP over HTTPS with 14 tools, 6 resources, and 3 prompts.",
};

export default function ConnectPage() {
  const mcpUrl = publicMcpUrl();
  const docsUrl = publicOpenApiDocsUrl();
  const apiBaseUrl = docsUrl.replace(/\/docs$/, "");
  const origin = site.origin;

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${origin}/connect#webpage`,
        url: `${origin}/connect`,
        name: "Connect MCP — CoinTrac",
        isPartOf: { "@id": `${origin}/#website` },
        description:
          "Setup snippets for connecting AI assistants and scripts to CoinTrac MCP and REST endpoints.",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: origin },
          { "@type": "ListItem", position: 2, name: "Connect MCP", item: `${origin}/connect` },
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
      <ConnectView mcpUrl={mcpUrl} docsUrl={docsUrl} apiBaseUrl={apiBaseUrl} />
    </>
  );
}
