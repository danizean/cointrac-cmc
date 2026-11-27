import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { CoinTracAIConsole } from "@/components/workspace/cointrac-ai-console";

export const metadata: Metadata = {
  title: "CoinTrac AI",
  description:
    "Precision crypto market intelligence analyst powered by Meta Muse Spark 1.3 with deterministic tool calling and evidence citations.",
};

export default function CoinTracAIPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <CoinTracAIConsole />
    </Suspense>
  );
}
