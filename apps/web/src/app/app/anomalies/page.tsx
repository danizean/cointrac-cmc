import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { AnomaliesDesk } from "@/components/workspace/anomalies-desk";

export const metadata: Metadata = {
  title: "Anomalies",
  description: "Statistical outlier scan for unusual volume spikes, price moves, and BTC divergences.",
};

export default function AnomaliesPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AnomaliesDesk />
    </Suspense>
  );
}
