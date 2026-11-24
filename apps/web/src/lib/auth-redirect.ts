/**
 * Strict internal redirect path sanitizer & password policy helpers (Stage 5.1).
 * Prevents open redirects in /login, /auth/callback, and proxy.ts.
 */

const BLOCKED_REDIRECT_PREFIXES = ["/api/", "/auth/", "/login", "/signup"];
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function sanitizeRedirectPath(
  candidate: string | null | undefined,
  fallback = "/app",
): string {
  if (!candidate || typeof candidate !== "string") return fallback;
  const trimmed = candidate.trim();
  if (!trimmed.startsWith("/")) return fallback;
  // Reject protocol-relative URLs (//evil.com), backslashes (/\evil.com), or control chars
  if (trimmed.startsWith("//") || trimmed.includes("\\") || CONTROL_CHARS.test(trimmed)) {
    return fallback;
  }
  // Reject URL-encoded slashes or backslashes attempting protocol-relative bypass
  if (/%2f/i.test(trimmed) || /%5c/i.test(trimmed)) {
    return fallback;
  }
  // Parse against a synthetic origin and ensure origin cannot change
  try {
    const parsed = new URL(trimmed, "https://cointrac.local");
    if (parsed.origin !== "https://cointrac.local") {
      return fallback;
    }
    const normalizedPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!normalizedPath.startsWith("/") || normalizedPath.startsWith("//")) {
      return fallback;
    }
    for (const prefix of BLOCKED_REDIRECT_PREFIXES) {
      if (parsed.pathname === prefix.replace(/\/$/, "") || parsed.pathname.startsWith(prefix)) {
        return fallback;
      }
    }
    return normalizedPath;
  } catch {
    return fallback;
  }
}

export type PasswordValidationResult = {
  valid: boolean;
  reason?: string;
};

export function validatePasswordStrength(password: string): PasswordValidationResult {
  if (password.length < 12) {
    return { valid: false, reason: "Password must be at least 12 characters long." };
  }
  if (password.length > 128) {
    return { valid: false, reason: "Password must be 128 characters or fewer." };
  }
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!hasLower || !hasUpper || !hasDigit) {
    return {
      valid: false,
      reason: "Password must include at least one uppercase letter, lowercase letter, and number.",
    };
  }
  return { valid: true };
}
