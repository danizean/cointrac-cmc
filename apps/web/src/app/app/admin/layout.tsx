import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { DeskSkeleton } from "@/components/ui/primitives";
import { resolveServerPlatformRole } from "@/lib/supabase/server";

async function AdminAccessGate({ children }: { children: ReactNode }) {
  const roleStatus = await resolveServerPlatformRole();
  if (roleStatus === "user") {
    redirect("/app");
  }
  return <>{children}</>;
}

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <AdminAccessGate>{children}</AdminAccessGate>
    </Suspense>
  );
}
