import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { DerivativesDesk } from "@/components/workspace/derivatives-desk";

export const metadata: Metadata = {
  title: "Derivatives",
  description: "Inspect open interest, funding rates, liquidations, and spot-stress signals.",
};

export default function DerivativesPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <DerivativesDesk />
    </Suspense>
  );
}
