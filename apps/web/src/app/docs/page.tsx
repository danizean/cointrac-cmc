import type { Metadata } from "next";
import { DocsView } from "@/components/marketing/docs-view";

export const metadata: Metadata = {
  title: "API",
  description:
    "CoinTrac REST paths, API key authentication, and links to the routes that exist in this application.",
};

export default function DocsPage() {
  return <DocsView />;
}
