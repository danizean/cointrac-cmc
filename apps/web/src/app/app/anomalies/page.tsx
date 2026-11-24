import type { Metadata } from "next";
import { AnalysisDesk } from "@/components/workspace/analysis-desk";

export const metadata: Metadata = {
  title: "Anomalies",
  description: "Statistical outlier scan using detect_market_anomalies.",
};

export default function AnomaliesPage() {
  return <AnalysisDesk pageKey="anomalies" tools={["detect_market_anomalies"]} fields={["quote", "universe"]} />;
}
