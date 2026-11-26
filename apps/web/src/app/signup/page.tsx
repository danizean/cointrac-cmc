import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { siteUrl } from "@/lib/site-url";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

const site = siteUrl();

export const metadata: Metadata = {
  title: "Create account — CoinTrac",
  alternates: { canonical: "/signup" },
  description:
    "Create your verified CoinTrac account to access deterministic crypto intelligence APIs, Hidden Gem Discovery, and Streamable HTTP MCP tools.",
  openGraph: {
    title: "Create your CoinTrac account",
    description:
      "Sign up for CoinTrac to generate API keys, configure MCP clients, and run live Market Intelligence.",
    url: new URL("/signup", site),
    type: "website",
    siteName: "CoinTrac",
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac Sign Up",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Create your CoinTrac account",
    description:
      "Start using CoinTrac deterministic Market Intelligence API & MCP tools.",
    images: ["/brand/cointrac-logo.png"],
  },
};

export default function SignupPage() {
  const configured = isSupabaseAuthConfigured();

  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-4 py-10 sm:px-6"
    >
      <SignupForm configured={configured} />
    </main>
  );
}
