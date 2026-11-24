import type { Metadata } from "next";
import { AnalysisDesk } from "@/components/workspace/analysis-desk";

export const metadata: Metadata = {
  title: "Market analysis",
  description: "Market overview and deterministic regime classification.",
};

export default function MarketPage() {
  return (
    <AnalysisDesk
      pageKey="market"
      tools={["get_market_overview", "analyze_market_regime"]}
      fields={["quote"]}
      autoRun
    />
  );
}
