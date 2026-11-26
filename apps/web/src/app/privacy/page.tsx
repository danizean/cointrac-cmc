import type { Metadata } from "next";
import { LegalView } from "@/components/marketing/legal-view";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
  description:
    "How CoinTrac handles accounts, hashed API keys, in-memory BYOK headers, OAuth 2.1 sessions, and tenant-isolated evidence logs.",
};

export default function PrivacyPage() {
  return <LegalView kind="privacy" />;
}
