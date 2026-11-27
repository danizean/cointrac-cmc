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
  code?: "too_short" | "too_long" | "missing_classes";
  reason?: string;
};

export function passwordFailureCopy(
  code: PasswordValidationResult["code"],
  isId: boolean,
): string {
  if (code === "too_short") {
    return isId ? "Kata sandi minimal 12 karakter." : "Password must be at least 12 characters long.";
  }
  if (code === "too_long") {
    return isId ? "Kata sandi maksimal 128 karakter." : "Password must be 128 characters or fewer.";
  }
  return isId
    ? "Kata sandi harus memuat huruf besar, huruf kecil, dan angka."
    : "Password must include at least one uppercase letter, lowercase letter, and number.";
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  if (password.length < 12) {
    return {
      valid: false,
      code: "too_short",
      reason: "Password must be at least 12 characters long.",
    };
  }
  if (password.length > 128) {
    return {
      valid: false,
      code: "too_long",
      reason: "Password must be 128 characters or fewer.",
    };
  }
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!hasLower || !hasUpper || !hasDigit) {
    return {
      valid: false,
      code: "missing_classes",
      reason: "Password must include at least one uppercase letter, lowercase letter, and number.",
    };
  }
  return { valid: true };
}

export const EMAIL_OTP_LENGTH = 6;

export function normalizeEmailOtp(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length === EMAIL_OTP_LENGTH ? digits : null;
}
