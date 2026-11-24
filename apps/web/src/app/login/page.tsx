import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your CoinTrac account.",
};

type LoginSearchParams = Promise<{
  next?: string;
  error?: string;
  signed_out?: string;
}>;

async function LoginContent({ searchParams }: { searchParams: LoginSearchParams }) {
  const params = await searchParams;
  const configured = isSupabaseAuthConfigured();

  return (
    <LoginForm
      configured={configured}
      nextPath={params.next ?? "/app"}
      initialError={params.error}
      signedOut={params.signed_out === "1"}
    />
  );
}

export default function LoginPage({ searchParams }: { searchParams: LoginSearchParams }) {
  return (
    <main id="content" className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-16">
      <Suspense
        fallback={
          <div className="tg-panel h-80 animate-pulse rounded-2xl p-8" aria-busy="true" />
        }
      >
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
