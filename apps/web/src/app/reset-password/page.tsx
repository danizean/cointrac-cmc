import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Reset password — CoinTrac",
  description: "Request a password reset or update your CoinTrac account password.",
};

type ResetSearchParams = Promise<{ mode?: string }>;

async function ResetPasswordContent({ searchParams }: { searchParams: ResetSearchParams }) {
  const params = await searchParams;
  const configured = isSupabaseAuthConfigured();
  const mode = params.mode === "update" ? "update" : "request";

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
