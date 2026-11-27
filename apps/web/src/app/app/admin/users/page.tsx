import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminUsersView } from "@/components/admin/admin-users-view";
import { DeskSkeleton } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Users & Quotas · Super Admin",
  description:
    "Manage per-user CoinTrac AI rate limits, daily quotas, access toggles, and platform roles.",
};

export default function SuperAdminUsersPage() {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AdminUsersView />
    </Suspense>
  );
}
