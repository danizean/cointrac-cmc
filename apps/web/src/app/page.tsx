import type { Metadata } from "next";
import { cookies } from "next/headers";
import { HomeView } from "@/components/marketing/home-view";
import { parseLocale } from "@/lib/i18n";
import { MARKETING } from "@/lib/marketing-copy";
import { siteUrl } from "@/lib/site-url";

const site = siteUrl();

export const metadata: Metadata = {
  title: {
    absolute: "CoinTrac — Trusted Crypto Market Data API & MCP Server",
  },
  description:
    "Connect ChatGPT, Claude, Gemini, and apps to CoinMarketCap data via 14 MCP tools and 10 REST endpoints with audited EvidenceEnvelope responses.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "CoinTrac — Crypto Market Intelligence API, Hidden Gem Discovery & MCP",
    description:
      "Deterministic cryptocurrency market data for apps and AI agents via REST and Streamable HTTP MCP. Missing data stays null and limitations stay explicit.",
    url: site,
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac Market Intelligence API & MCP Server",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinTrac — Crypto Market Intelligence API, Hidden Gem Discovery & MCP",
    description:
      "Call market-intelligence tools and Hidden Gem Discovery over REST or Streamable HTTP MCP.",
    images: ["/brand/cointrac-logo.png"],
  },
};

export default async function HomePage() {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get("tg_locale")?.value);
  const homeCopy = MARKETING[locale].home;
  const origin = site.origin;

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "CoinTrac",
        url: origin,
        email: "support@cointrac.xyz",
        logo: {
          "@type": "ImageObject",
          url: `${origin}/brand/cointrac-logo.png`,
        },
        description: homeCopy.lede,
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: origin,
        name: "CoinTrac",
        publisher: { "@id": `${origin}/#organization` },
        inLanguage: locale === "id" ? "id-ID" : "en-US",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#application`,
        name: "CoinTrac Market Intelligence API & MCP Server",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Cross-platform",
        url: origin,
        description: homeCopy.lede,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${origin}/#faq`,
        mainEntity: homeCopy.faq.map((item) => ({
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
      <HomeView />
    </>
  );
}
