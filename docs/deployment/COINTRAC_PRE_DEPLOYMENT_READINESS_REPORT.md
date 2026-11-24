# CoinTrac pre-deployment readiness report

**Verdict: BLOCKED**

The repository now has a Vercel root, a loopback-only VPS compose file, and domain documentation. CoinTrac is not production-ready. DNS does not resolve, the VPS has no public TLS listener, and no deployment image was built or started.

## Architecture found

This is a monorepo.

| Piece | Location | Deployment target |
|---|---|---|
| Next.js 16 app | `apps/web` | Vercel Hobby. Root Directory `apps/web`. |
| FastAPI app | `apps/intelligence` | VPS, one container |
| MCP | `apps/intelligence/app/mcp/server.py`, mounted in `app/main.py` | Same container as FastAPI |
| Local compose | `docker-compose.yml` | Developer machine only |
| VPS compose | `docker-compose.vps.yml` | Intelligence container only |
| Capability matrix | `docs/CMC_CAPABILITY_MATRIX.json` | Copied into the intelligence image |

MCP transport is Streamable HTTP at `/mcp` and `/mcp/`, with no redirect between them. Stateless HTTP is the default. stdio remains a local entrypoint in `apps/intelligence/app/mcp/stdio_entry.py` and is not the public remote transport. Remote clients that omit `Origin` are accepted. Clients that send `Origin` must match `MCP_ALLOWED_ORIGINS`. The `Host` header must match `MCP_ALLOWED_HOSTS`.

`mcp.cointrac.xyz` is a second hostname for the same process. The public MCP URL is `https://mcp.cointrac.xyz/mcp`. REST stays at `https://api.cointrac.xyz`. Nginx on the VPS, not a second application, makes that split.

## Files inspected

- `apps/web/next.config.ts`, `src/app/layout.tsx`, `src/proxy.ts`, `src/app/auth/callback/route.ts`
- `apps/web/src/lib/env.ts`, `catalog.ts`, `supabase/config.ts`, `intelligence-target.ts`
- `apps/web/Dockerfile`, `package.json`
- `apps/intelligence/app/main.py`, `app/core/config.py`, `app/mcp/server.py`, `Dockerfile`
- `docker-compose.yml`, `.env.example`, `.gitignore`
- Auth forms that already use `window.location.origin` for Supabase redirects

No Content-Security-Policy header exists. The root layout injects two small scripts for theme and locale, so a strict CSP would break the current UI. Existing headers remain `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy`. CSP was left unset on purpose.

Historical marketing copy still mentions the local Antigravity check at `http://127.0.0.1:8000/mcp/`. That sentence is an audit record, not a request URL.

## Files modified

- `apps/web/src/lib/site-url.ts` and `site-url.test.ts`
- `apps/web/src/app/layout.tsx`, `robots.ts`, `sitemap.ts`, `next.config.ts`
- `apps/web/src/lib/catalog.ts`, `env.ts`, `package.json`
- `apps/intelligence/app/core/config.py`, `app/main.py`, `Dockerfile`
- `apps/intelligence/tests/test_remote_mcp.py`
- `docker-compose.yml`, `docker-compose.vps.yml`
- `.github/workflows/intelligence-image.yml`
- `.env.example`, `.gitignore`

## Configuration changes

- Canonical metadata uses `NEXT_PUBLIC_SITE_URL`, then `https://cointrac.xyz` when `VERCEL_ENV=production`, otherwise `http://localhost:3000`.
- `www.cointrac.xyz` redirects permanently to `https://cointrac.xyz`.
- `sitemap.ts` and `robots.ts` use that same site URL. `robots` points at `/sitemap.xml` and disallows `/app` and `/api/`.
- Production MCP snippets fall back to `https://mcp.cointrac.xyz/mcp` only when `NODE_ENV=production` and no public URL is set. `next dev` stays on localhost.
- Vercel production API calls fall back to `https://api.cointrac.xyz` only when `VERCEL_ENV=production` and `INTELLIGENCE_API_URL` is unset.
- `CORS_ORIGINS=*` and wildcard trusted hosts are rejected. Credentialed CORS is not enabled.
- `TRUSTED_HOSTS`, when set, is enforced. Local default is empty, so local runs do not gain a new host check.
- `PUBLIC_API_BASE_URL`, when set, becomes the OpenAPI server URL. It must be HTTPS and must not be localhost.
- The intelligence image build context is the repository root and includes the capability matrix. No secret file is copied.
- Local compose publishes `127.0.0.1:3000` and `127.0.0.1:8000` instead of all interfaces.
- VPS compose does not run Next.js, does not publish a public port, limits memory to 768 MiB, and trusts forwarded headers only from loopback.

## Environment names by platform

Vercel, names only:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `INTELLIGENCE_API_URL`
- `NEXT_PUBLIC_MCP_PUBLIC_URL`
- `SANDBOX_API_KEY` server-only

VPS `.env`, names only:

- `CMC_API_KEY`
- `CMC_BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SANDBOX_API_KEY`
- `ENGINE_VERSION`

VPS compose sets `CORS_ORIGINS`, `TRUSTED_HOSTS`, `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS`, `PUBLIC_API_BASE_URL`, and `REMOTE_MCP_PUBLIC_URL`.

Supabase dashboard, not edited here:

- Site URL `https://cointrac.xyz`
- Redirects `https://cointrac.xyz/auth/callback`, `https://www.cointrac.xyz/auth/callback`, `http://localhost:3000/auth/callback`

## DNS and routing

Records and the nameserver blocker are in `COINTRAC_DOMAIN_DNS_SETUP.md`.

- `cointrac.xyz` and `www.cointrac.xyz` go to Vercel.
- `api.cointrac.xyz` and `mcp.cointrac.xyz` go to `43.133.139.3`.
- REST is the FastAPI app behind Nginx.
- MCP is Streamable HTTP at `/mcp` on that same app.

## Checks

| Check | Result |
|---|---|
| Frontend unit tests | Pass. 34 tests, 0 failed. |
| TypeScript | Pass. `tsc --noEmit`. |
| ESLint | Pass on the files changed in `apps/web`. |
| Next.js production build | Pass. Next.js 16.4.6 produced `/robots.txt` and `/sitemap.xml`. This was a local build, so its metadata base stays on localhost. Vercel sets `VERCEL_ENV=production`. |
| Backend settings tests | Pass. Ruff clean. 4 selected pytest tests passed. |
| Full backend pytest | Not run. The full suite has written Development rate-window rows before. This task forbids Development database writes. |
| Docker image build and run | Not verified. No image was built or started. |
| `docker compose config` | Not verified. `docker` is not installed on this machine. |
| Secret scan of the new deployment files | Pass. No tokens or private keys in the new docs, workflow, or VPS compose file. |
| Production domain scan | Local development still falls back to localhost. Production fallbacks are `https://cointrac.xyz`, `https://api.cointrac.xyz`, and `https://mcp.cointrac.xyz/mcp`. |

## Remaining manual work

1. Repair IDwebhost delegation so the zone stops returning SERVFAIL and REFUSED.
2. Copy Vercel DNS targets into the zone. Do not invent them.
3. Create the Vercel project with root `apps/web` and the environment names above.
4. Set Supabase Auth URLs.
5. Publish the intelligence image, then pull it on the VPS.
6. Add Nginx TLS server blocks for `api` and `mcp` without removing the current port 80 service.
7. Harden SSH and enable a firewall.
8. Run a real health check and an authenticated MCP session after those steps.

## Security risks

- The audited VPS still allows SSH root login and password authentication, and UFW is off. That is a host risk, not a repository change.
- Port 443 was unreachable, so public HTTPS for the API and MCP does not exist yet.
- `SANDBOX_API_KEY` on Vercel can call the API as that key. Keep it server-only.
- Service-role and CoinMarketCap credentials belong only in the VPS environment.
- No CSP is set because the current theme and locale scripts are inline.

## Deployment blockers

1. Authoritative DNS for `cointrac.xyz` is broken.
2. The VPS has no verified TLS path on port 443.
3. No intelligence image has been built, published, or started.
4. Vercel has not been connected, and this task does not deploy it.
