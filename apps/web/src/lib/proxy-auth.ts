/**
 * Browser proxy authentication. The session access token is the only credential
 * forwarded to FastAPI. Shared sandbox keys and client owner headers are not used.
 */
export function proxyAuthHeaders(accessToken: string | null | undefined): Headers | null {
  const token = accessToken?.trim() ?? "";
  if (!token || token.split(".").length !== 3) return null;
  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  return headers;
}
