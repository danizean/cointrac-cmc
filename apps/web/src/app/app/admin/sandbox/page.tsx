import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { CoinTracAIConsole } from "@/components/workspace/cointrac-ai-console";

export const metadata: Metadata = {
  title: "AI Live Sandbox · Super Admin",
  description:
    "Test CoinTrac AI (Muse Spark 1.3) directly inside the Super Admin Console to validate system directives and tool calling behavior.",
};

export default function AdminAISandboxPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <CoinTracAIConsole mode="admin_sandbox" />
    </Suspense>
  );
}
