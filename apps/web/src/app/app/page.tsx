import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { resolveServerPlatformRole } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "CoinTrac workspace readiness, quickstart onboarding, real evidence activity, and direct access to Market Intelligence, API Keys, and MCP Connections.",
};

async function AppHomeGate() {
  const roleStatus = await resolveServerPlatformRole();
  if (roleStatus === "super_admin") {
    redirect("/app/admin");
  }
  return <WorkspaceOverview />;
}

export default function AppHomePage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AppHomeGate />
    </Suspense>
  );
}
