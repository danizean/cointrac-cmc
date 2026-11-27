import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

const NO_STORE = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export async function POST() {
  const email = process.env.DEMO_LOGIN_EMAIL?.trim() ?? "";
  const password = process.env.DEMO_LOGIN_PASSWORD ?? "";
  const cfg = getSupabasePublicConfig();
  if (!cfg || !email || !password) {
    return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503, headers: NO_STORE });
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  const supabase = createServerClient(cfg.url, cfg.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const lower = error.message.toLowerCase();
    const reason = lower.includes("not confirmed") ? "unconfirmed" : "failed";
    return NextResponse.json({ ok: false, reason }, { status: 403, headers: NO_STORE });
  }

  return response;
}
