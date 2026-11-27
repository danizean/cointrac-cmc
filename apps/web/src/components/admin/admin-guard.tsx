"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";
import { useAppPreferences } from "@/components/app-preferences";
import { Button, Card, ErrorNotice, PageHeader, Skeleton } from "@/components/ui/primitives";
import { useAdminData } from "./admin-context";

export function AdminAccessBarrier({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { error, loading, refreshing, refresh } = useAdminData();

  if (error && (error.status === 401 || error.status === 403)) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} description={description} />
        <Card className="border-destructive/40 bg-destructive-soft/40 p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-foreground">
                {isId
                  ? "Akses Super Admin Ditolak (HTTP 403)"
                  : "Super Admin Access Restricted (403)"}
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {error.message}{" "}
                {isId
                  ? "Pastikan email terverifikasi Anda terdaftar di SUPER_ADMIN_EMAILS atau profiles.platform_role = 'super_admin'."
                  : "Ensure your verified email is listed in SUPER_ADMIN_EMAILS or profiles.platform_role = 'super_admin'."}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button
            variant="secondary"
            size="md"
            loading={loading || refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>{isId ? "Muat ulang" : "Refresh"}</span>
          </Button>
        }
      />
      {error ? (
        <ErrorNotice status={error.status} message={error.message} onRetry={() => void refresh()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Card key={idx} className="p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-8 w-28" />
              <Skeleton className="mt-2 h-3 w-36" />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
