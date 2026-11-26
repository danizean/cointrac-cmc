export type SessionProbe = "authenticated" | "anonymous" | "unavailable";

export interface AccountSessionStatus {
  status: "authenticated" | "anonymous" | "email_unverified" | "unavailable";
  email: string | null;
}

export async function probeSession(
  fetchImpl: typeof fetch = fetch,
): Promise<SessionProbe> {
  try {
    const response = await fetchImpl("/api/auth/me", { cache: "no-store" });
    if (response.ok) return "authenticated";
    if (response.status === 401) return "anonymous";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function probeAccountSession(
  fetchImpl: typeof fetch = fetch,
): Promise<AccountSessionStatus> {
  try {
    const response = await fetchImpl("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return { status: "unavailable", email: null };
    const payload = (await response.json()) as {
      authenticated?: unknown;
      emailVerified?: unknown;
      email?: unknown;
    };
    const email = typeof payload.email === "string" ? payload.email : null;
    if (payload.authenticated === true) {
      return { status: "authenticated", email };
    }
    if (email && payload.emailVerified === false) {
      return { status: "email_unverified", email };
    }
    return { status: "anonymous", email: null };
  } catch {
    return { status: "unavailable", email: null };
  }
}
