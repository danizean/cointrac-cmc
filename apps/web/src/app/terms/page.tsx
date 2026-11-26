import type { Metadata } from "next";
import { LegalView } from "@/components/marketing/legal-view";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/terms" },
  description:
    "CoinTrac read-only market intelligence terms, CoinMarketCap data disclosures, rate limits, and non-advisory notice.",
};

export default function TermsPage() {
  return <LegalView kind="terms" />;
}
