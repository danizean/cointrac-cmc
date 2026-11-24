import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a CoinTrac account with email verification.",
};

export default function SignupPage() {
  const configured = isSupabaseAuthConfigured();

  return (
    <main id="content" className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-16">
      <SignupForm configured={configured} />
    </main>
  );
}
