import type { Metadata } from "next";
import { HomeView } from "@/components/marketing/home-view";

export const metadata: Metadata = {
  title: "CoinTrac — Crypto market intelligence for APIs and MCP",
  description:
    "Call ten market-intelligence tools over REST or MCP. Every result keeps its status, freshness, and limits.",
};

export default function HomePage() {
  return <HomeView />;
}
