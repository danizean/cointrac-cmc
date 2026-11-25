import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { AssetDesk } from "@/components/workspace/asset-desk";

export const metadata: Metadata = {
  title: "Asset analysis",
  description: "Asset profile, momentum, and comparison from the existing intelligence tools.",
};

export default function AssetsPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AssetDesk />
    </Suspense>
  );
}
