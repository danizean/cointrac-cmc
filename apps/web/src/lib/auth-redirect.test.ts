import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEmailOtp,
  sanitizeRedirectPath,
  validatePasswordStrength,
} from "./auth-redirect.ts";

test("sanitizeRedirectPath allows safe internal workspace routes", () => {
  assert.equal(sanitizeRedirectPath("/app"), "/app");
  assert.equal(sanitizeRedirectPath("/app/keys"), "/app/keys");
  assert.equal(sanitizeRedirectPath("/app/usage?range=7d"), "/app/usage?range=7d");
  assert.equal(sanitizeRedirectPath("/reset-password?mode=update"), "/reset-password?mode=update");
});

test("sanitizeRedirectPath blocks open redirect vectors", () => {
  const attacks = [
    "https://evil.example/phish",
    "http://evil.example",
    "//evil.example/app",
    "///evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/%2f%2fevil.example",
    "/%5cevil.example",
    "/app\r\nSet-Cookie: a=b",
    "evil.example/app",
    "",
    null,
    undefined,
  ];
  for (const vector of attacks) {
    assert.equal(sanitizeRedirectPath(vector, "/app"), "/app", `failed for vector: ${String(vector)}`);
  }
});

test("sanitizeRedirectPath blocks redirect loops to auth or api endpoints", () => {
  assert.equal(sanitizeRedirectPath("/login"), "/app");
  assert.equal(sanitizeRedirectPath("/signup"), "/app");
  assert.equal(sanitizeRedirectPath("/auth/callback?code=123"), "/app");
  assert.equal(sanitizeRedirectPath("/api/auth/me"), "/app");
});

test("normalizeEmailOtp keeps a 6-digit code and rejects anything else", () => {
  assert.equal(normalizeEmailOtp("123456"), "123456");
  assert.equal(normalizeEmailOtp(" 123-456 "), "123456");
  assert.equal(normalizeEmailOtp("12345"), null);
  assert.equal(normalizeEmailOtp("12345678"), null);
  assert.equal(normalizeEmailOtp("12ab56"), null);
});

test("validatePasswordStrength enforces minimum length and character classes", () => {
  assert.equal(validatePasswordStrength("Short1A").valid, false);
  assert.equal(validatePasswordStrength("alllowercase123").valid, false);
  assert.equal(validatePasswordStrength("ALLUPPERCASE123").valid, false);
  assert.equal(validatePasswordStrength("NoDigitsHereAA").valid, false);
  assert.equal(validatePasswordStrength("CoinTrac2026!").valid, true);
});
