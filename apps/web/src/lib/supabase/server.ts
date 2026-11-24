import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getSupabasePublicConfig } from "./config";

export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const cfg = getSupabasePublicConfig();
  if (!cfg) return null;

  // GoTrueClient measures session expiry with Date.now() after the cookies
  // are read. Cache Components rejects that clock read during prerender, so
  // wait for the real request before constructing the client.
  await connection();

  const cookieStore = await cookies();
  return createServerClient(cfg.url, cfg.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot mutate response cookies directly;
          // src/proxy.ts refreshes session cookies on every request.
        }
      },
    },
  });
}

export type VerifiedServerIdentity = {
  configured: boolean;
  user: User | null;
  emailVerified: boolean;
};

/**
 * Always verifies the user against Supabase Auth via getUser() rather than
 * trusting unverified cookie contents from getSession().
 */
export async function getVerifiedServerIdentity(): Promise<VerifiedServerIdentity> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { configured: false, user: null, emailVerified: false };
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { configured: true, user: null, emailVerified: false };
  }

  return {
    configured: true,
    user,
    emailVerified: Boolean(user.email_confirmed_at),
  };
}
