import type { Metadata } from "next";
import { AnalysisDesk } from "@/components/workspace/analysis-desk";

export const metadata: Metadata = {
  title: "Sector rotation",
  description: "Sector rotation across the seven canonical sectors.",
};

export default function SectorsPage() {
  return <AnalysisDesk pageKey="sectors" tools={["analyze_sector_rotation"]} fields={["quote", "sectors"]} />;
}
