import type { Metadata } from "next";
import { AnalysisDesk } from "@/components/workspace/analysis-desk";

export const metadata: Metadata = {
  title: "Market movers",
  description: "Rule-based momentum screen using scan_market_movers.",
};

export default function MoversPage() {
  return <AnalysisDesk pageKey="movers" tools={["scan_market_movers"]} fields={["quote", "movers"]} />;
}
