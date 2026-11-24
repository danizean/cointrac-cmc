const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALLOWED_ROOTS = new Set(["health", "v1"]);
const MAX_SEARCH_LENGTH = 2048;

export type TargetResult =
  | { ok: true; url: URL }
  | { ok: false; status: 400 | 500; summary: string };

export function resolveIntelligenceTarget(
  baseRaw: string,
  path: string[],
  search: string,
): TargetResult {
  const base = parseBase(baseRaw);
  if (!base.ok) return base;

  if (path.length === 0 || path.some((segment) => !SEGMENT.test(segment))) {
    return { ok: false, status: 400, summary: "The request path is not valid." };
  }
  if (!ALLOWED_ROOTS.has(path[0])) {
    return { ok: false, status: 400, summary: "The request path is not valid." };
  }
  if (path[0] === "v1" && path.length < 2) {
    return { ok: false, status: 400, summary: "The request path is not valid." };
  }
  if (search.length > MAX_SEARCH_LENGTH || /[\r\n]/.test(search)) {
    return { ok: false, status: 400, summary: "The request path is not valid." };
  }
  if (search !== "" && !search.startsWith("?")) {
    return { ok: false, status: 400, summary: "The request path is not valid." };
  }

  const target = new URL(`${path.join("/")}${search}`, base.url);
  if (target.origin !== base.url.origin) {
    return { ok: false, status: 400, summary: "The request path is not valid." };
  }
  return { ok: true, url: target };
}

function parseBase(baseRaw: string): { ok: true; url: URL } | { ok: false; status: 500; summary: string } {
  let url: URL;
  try {
    url = new URL(baseRaw);
  } catch {
    return { ok: false, status: 500, summary: "The intelligence API URL is not valid." };
  }

  if (url.username !== "" || url.password !== "") {
    return { ok: false, status: 500, summary: "The intelligence API URL is not valid." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, status: 500, summary: "The intelligence API URL is not valid." };
  }
  if (isBlockedHostname(url.hostname)) {
    return { ok: false, status: 500, summary: "The intelligence API URL is not valid." };
  }
  if (url.protocol === "http:" && !isLocalHttpHost(url.hostname)) {
    return { ok: false, status: 500, summary: "The intelligence API URL is not valid." };
  }

  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return { ok: true, url };
}

function isLocalHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return true;
  }
  return !host.includes(".") && !host.includes(":");
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "metadata.google.internal" ||
    host.endsWith(".metadata.google.internal") ||
    host === "metadata.internal"
  ) {
    return true;
  }

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
