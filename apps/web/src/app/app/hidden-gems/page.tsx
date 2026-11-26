import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { HiddenGemsDesk } from "@/components/workspace/hidden-gems-desk";

export const metadata: Metadata = {
  title: "Hidden Gem Discovery",
  description:
    "Deterministic Early Asymmetric & Confirmed Momentum crypto discovery engine with audited evidence.",
};

export default function HiddenGemsPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <HiddenGemsDesk />
    </Suspense>
  );
}
