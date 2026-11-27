import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { MarketDesk } from "@/components/workspace/market-desk";

export const metadata: Metadata = {
  title: "Market analysis",
  description: "Market overview and deterministic regime classification.",
};

export default function MarketPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <MarketDesk />
    </Suspense>
  );
}
