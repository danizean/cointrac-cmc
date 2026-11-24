import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Reset password",
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
    <main id="content" className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-16">
      <Suspense
        fallback={
          <div className="tg-panel h-72 animate-pulse rounded-2xl p-8" aria-busy="true" />
        }
      >
        <ResetPasswordContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
