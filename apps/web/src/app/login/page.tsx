import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { siteUrl } from "@/lib/site-url";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

const site = siteUrl();

export const metadata: Metadata = {
  title: "Sign in — CoinTrac",
  alternates: { canonical: "/login" },
  description:
    "Sign in to your verified CoinTrac account to access Market Intelligence, Hidden Gem Discovery, API Keys, MCP Connections, and live Playground execution.",
  openGraph: {
    title: "Sign in to CoinTrac",
    description:
      "Access your CoinTrac Market Intelligence workspace, MCP credentials, and audited EvidenceEnvelope logs.",
    url: new URL("/login", site),
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac Workspace Sign In",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sign in to CoinTrac",
    description:
      "Sign in to access CoinTrac Market Intelligence, MCP Connections, and API keys.",
    images: ["/brand/cointrac-logo.png"],
  },
};

type LoginSearchParams = Promise<{
  next?: string;
  error?: string;
  signed_out?: string;
  password_updated?: string;
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
      passwordUpdated={params.password_updated === "1"}
    />
  );
}

export default function LoginPage({ searchParams }: { searchParams: LoginSearchParams }) {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-4 py-10 sm:px-6"
    >
      <Suspense
        fallback={
          <div className="ct-surface-featured h-[420px] w-full animate-pulse rounded-[18px]" />
        }
      >
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
