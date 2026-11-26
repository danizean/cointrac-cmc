import { NextResponse } from "next/server";
import { getVerifiedServerIdentity } from "@/lib/supabase/server";

/**
 * Lightweight browser session probe backed strictly by supabase.auth.getUser().
 * Unlike /api/auth/me, this does not fail with 503 if the FastAPI backend is
 * temporarily offline, so public pages (/playground, header nav) accurately
 * reflect the same Supabase login state as /app.
 */
export async function GET() {
  const { configured, user, emailVerified } = await getVerifiedServerIdentity();

  return NextResponse.json(
    {
      configured,
      authenticated: Boolean(user && emailVerified),
      emailVerified,
      email: user?.email ?? null,
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
