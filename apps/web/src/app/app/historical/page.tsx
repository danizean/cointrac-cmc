import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { HistoricalDesk } from "@/components/workspace/historical-desk";

export const metadata: Metadata = {
  title: "Historical performance",
  description: "Review daily closing returns, 365d volatility, beta vs BTC, and max drawdown.",
};

export default function HistoricalPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <HistoricalDesk />
    </Suspense>
  );
}
