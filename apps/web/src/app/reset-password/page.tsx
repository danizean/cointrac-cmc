import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Reset password — CoinTrac",
  description: "Request a 6-digit CoinTrac password reset code or set a new password.",
};

type ResetSearchParams = Promise<{ mode?: string }>;

async function ResetPasswordContent({ searchParams }: { searchParams: ResetSearchParams }) {
  const params = await searchParams;
  const configured = isSupabaseAuthConfigured();
  const recovery = (await cookies()).get("ct_recovery")?.value === "1";
  const mode = params.mode === "update" || recovery ? "update" : "request";

  return <ResetPasswordForm configured={configured} mode={mode} />;
}

export default function ResetPasswordPage({ searchParams }: { searchParams: ResetSearchParams }) {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-4 py-10 sm:px-6"
    >
      <Suspense
        fallback={
          <div className="ct-surface-featured h-72 w-full animate-pulse rounded-[18px]" aria-busy="true" />
        }
      >
        <ResetPasswordContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
