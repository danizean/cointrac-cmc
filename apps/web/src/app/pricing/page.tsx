import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PricingView } from "@/components/marketing/pricing-view";
import { parseLocale } from "@/lib/i18n";
import { PRICING_COPY } from "@/lib/pricing-copy";
import { siteUrl } from "@/lib/site-url";

const site = siteUrl();

export const metadata: Metadata = {
  title: "Pricing & Quotas — Free API Keys, MCP Access & BYOK",
  alternates: { canonical: "/pricing" },
  description:
    "CoinTrac pricing and limits: free developer accounts with 5 active API keys, 60 req/min, 14 MCP tools, 0 credits on cache hit, and optional BYOK CoinMarketCap support.",
  openGraph: {
    title: "CoinTrac Pricing & Quotas — Free Developer Beta",
    description:
      "Start free with 5 active API keys, 60 req/min per key, 10 intelligence REST endpoints, and 14 Streamable HTTP MCP tools.",
    url: new URL("/pricing", site),
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac Pricing and API Quotas",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinTrac Pricing & Quotas",
    description:
      "Currently free to use with 5 active API keys, 60 req/min, 14 MCP tools, and 0 credits on cache hit.",
    images: ["/brand/cointrac-logo.png"],
  },
};

export default async function PricingPage() {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get("tg_locale")?.value);
  const copy = PRICING_COPY[locale];
  const origin = site.origin;

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${origin}/pricing#webpage`,
        url: `${origin}/pricing`,
        name: "CoinTrac Pricing & Quotas",
        isPartOf: { "@id": `${origin}/#website` },
        description: copy.lede,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: origin },
          { "@type": "ListItem", position: 2, name: "Pricing", item: `${origin}/pricing` },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${origin}/pricing#faq`,
        mainEntity: copy.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
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
      <PricingView />
    </>
  );
}
