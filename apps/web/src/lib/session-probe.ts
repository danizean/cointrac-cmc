export type SessionProbe = "authenticated" | "anonymous" | "unavailable";

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
