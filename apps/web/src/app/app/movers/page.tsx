import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { MoversDesk } from "@/components/workspace/movers-desk";

export const metadata: Metadata = {
  title: "Market movers",
  description: "Rule-based anti-chase momentum screener for liquid crypto assets.",
};

export default function MoversPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <MoversDesk />
    </Suspense>
  );
}
