import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminOverviewView } from "@/components/admin/admin-overview-view";
import { DeskSkeleton } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Executive Overview · Super Admin",
  description:
    "CoinTrac Super Admin executive overview: Muse Spark 1.3 performance, token spend, cache efficiency, and governance signals.",
};

export default function SuperAdminOverviewPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AdminOverviewView />
    </Suspense>
  );
}
