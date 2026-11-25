import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { SectorsDesk } from "@/components/workspace/sectors-desk";

export const metadata: Metadata = {
  title: "Sector rotation",
  description: "Compare capital rotation and performance across DeFi, AI, L1, L2, Gaming, RWA, and Memecoins.",
};

export default function SectorsPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <SectorsDesk />
    </Suspense>
  );
}
