import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { SuperAdminConsole } from "@/components/workspace/super-admin-console";

export const metadata: Metadata = {
  title: "Super Admin Governance",
  description:
    "Restricted Super Admin dashboard for CoinTrac AI usage monitoring, Muse Spark 1.3 runtime settings, and per-user rate limit management.",
};

export default function SuperAdminPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <SuperAdminConsole />
    </Suspense>
  );
}
