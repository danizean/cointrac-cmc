import type { Metadata } from "next";
import { AnalysisDesk } from "@/components/workspace/analysis-desk";

export const metadata: Metadata = {
  title: "Derivatives",
  description: "Derivatives context or the spot-stress proxy for one asset.",
};

export default function DerivativesPage() {
  return <AnalysisDesk pageKey="derivatives" tools={["analyze_derivatives"]} fields={["quote", "symbol"]} />;
}
