import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { AnalysisDesk } from "@/components/workspace/analysis-desk";

export const metadata: Metadata = {
  title: "Market analysis",
  description: "Market overview and deterministic regime classification.",
};

export default function MarketPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AnalysisDesk
        pageKey="market"
        tools={["get_market_overview", "analyze_market_regime"]}
        fields={["quote"]}
      />
    </Suspense>
  );
}
