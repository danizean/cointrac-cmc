"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AdminDataProvider } from "@/components/admin/admin-context";
import { AdminShell } from "@/components/admin/admin-shell";
import { DeskSkeleton } from "@/components/ui/primitives";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { isAdminRoutePath } from "@/lib/admin-navigation";
import type { PlatformRoleStatus } from "@/lib/supabase/server";

export function AppRoleShell({
  email,
  platformRoleStatus,
  children,
}: {
  email: string;
  platformRoleStatus: PlatformRoleStatus;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const onAdminRoute = isAdminRoutePath(pathname);

  useEffect(() => {
    if (platformRoleStatus === "super_admin" && !onAdminRoute) {
      router.replace("/app/admin");
    } else if (platformRoleStatus === "user" && onAdminRoute) {
      router.replace("/app");
    }
  }, [platformRoleStatus, onAdminRoute, router]);

  if (platformRoleStatus === "super_admin") {
    if (!onAdminRoute) {
      return (
        <main id="content" className="mx-auto max-w-4xl px-4 py-12">
          <DeskSkeleton />
        </main>
      );
    }
    return (
      <AdminDataProvider>
        <AdminShell email={email}>{children}</AdminShell>
      </AdminDataProvider>
    );
  }

  if (platformRoleStatus === "user" && onAdminRoute) {
    return (
      <main id="content" className="mx-auto max-w-4xl px-4 py-12">
        <DeskSkeleton />
      </main>
    );
  }

  if (onAdminRoute) {
    return (
      <AdminDataProvider>
        <AdminShell email={email}>{children}</AdminShell>
      </AdminDataProvider>
    );
  }

  return <WorkspaceShell email={email}>{children}</WorkspaceShell>;
}
