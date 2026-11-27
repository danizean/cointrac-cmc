import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminAuditView } from "@/components/admin/admin-audit-view";
import { DeskSkeleton } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Audit & Telemetry · Super Admin",
  description:
    "Inspect CoinTrac AI audit logs, tool invocations, evidence IDs, latency, and rate-limit blocks.",
};

export default function SuperAdminAuditPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AdminAuditView />
    </Suspense>
  );
}
