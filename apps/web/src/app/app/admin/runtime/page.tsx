import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminRuntimeView } from "@/components/admin/admin-runtime-view";
import { DeskSkeleton } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "AI Runtime & Policy · Super Admin",
  description:
    "Configure global CoinTrac AI kill switch, Muse Spark 1.3 credentials, default limits, and inference policy.",
};

export default function SuperAdminRuntimePage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AdminRuntimeView />
    </Suspense>
  );
}
