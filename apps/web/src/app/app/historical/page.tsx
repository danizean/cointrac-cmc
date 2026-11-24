import type { Metadata } from "next";
import { AnalysisDesk } from "@/components/workspace/analysis-desk";

export const metadata: Metadata = {
  title: "Historical performance",
  description: "Historical return statistics when the data plan provides them.",
};

export default function HistoricalPage() {
  return (
    <AnalysisDesk
      pageKey="historical"
      tools={["get_historical_performance"]}
      fields={["quote", "symbol", "count"]}
    />
  );
}
