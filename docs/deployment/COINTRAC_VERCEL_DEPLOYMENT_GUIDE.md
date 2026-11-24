# CoinTrac Vercel deployment guide

The site deploys from the monorepo directory `apps/web`. Do not deploy this Next.js app to the VPS.

## Project settings

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Framework preset | Next.js |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output | Next.js default. Do not set `output: "export"`. |
| Node.js | 20 or newer. The optional web image uses Node 22. |

There is no root `package.json`. The lockfile is `apps/web/package-lock.json`. Leave TypeScript and ESLint build checks enabled. Do not add a `vercel.json` override for this project. `apps/web/next.config.ts` already sets image hosts, security headers, and the `www.cointrac.xyz` to `https://cointrac.xyz` redirect.

`cacheComponents` and `partialPrefetching` stay enabled. Route files do not export `runtime`, `dynamic`, `revalidate`, or `fetchCache`.

## Domains

Add both names to the same Vercel project:

- `cointrac.xyz` is the canonical production domain.
- `www.cointrac.xyz` is attached so Vercel accepts the host, then the app redirects it to the apex.

Copy the A and CNAME targets from the Vercel domain screen into IDwebhost. Those targets are not stored in this repository. DNS is still blocked by the nameserver REFUSED result in `COINTRAC_DOMAIN_DNS_SETUP.md`.

## Environment variables

Set these in the Vercel project. Values stay in Vercel. Do not commit them.

| Name | Exposure | Production value shape |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public, build time | `https://cointrac.xyz` |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | `https://<development-or-chosen-project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key | Supabase publishable key |
| `INTELLIGENCE_API_URL` | Server only | `https://api.cointrac.xyz` |
| `NEXT_PUBLIC_MCP_PUBLIC_URL` | Public, build time | `https://mcp.cointrac.xyz/mcp` |
| `SANDBOX_API_KEY` | Server only | Server-side playground key. Never `NEXT_PUBLIC_`. |

`VERCEL_ENV=production` is set by Vercel. When `NEXT_PUBLIC_SITE_URL` is absent there, canonical metadata falls back to `https://cointrac.xyz`. Local `npm run dev` keeps `http://localhost:3000`.

The browser calls `/api/cointrac/*` only. That route reads `INTELLIGENCE_API_URL` on the server. A production function without that variable calls `https://api.cointrac.xyz` instead of localhost. Local development still uses `http://127.0.0.1:8000`.

Do not set `CMC_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in Vercel or anywhere under `apps/web`.

## Supabase Auth URLs

In the Supabase project that this deployment is allowed to use, set:

- Site URL: `https://cointrac.xyz`
- Redirect URLs: `https://cointrac.xyz/auth/callback`, `https://www.cointrac.xyz/auth/callback`, and `http://localhost:3000/auth/callback`

The app already builds those callback URLs from `window.location.origin`. This repository does not change Supabase settings.

## Hobby plan limits

Vercel Hobby is a personal plan. Confirm the current Hobby terms before a commercial launch. This guide does not bypass plan limits.

The dashboard proxy waits on the intelligence API. Check the current Hobby function duration in the project before expecting slow CoinMarketCap calls to finish inside a Vercel function. MCP clients do not use that function. They connect to `https://mcp.cointrac.xyz/mcp`.

No package in `apps/web` needs a native build toolchain beyond what `npm ci` and `next build` install. Remote images are limited to `s2.coinmarketcap.com` coin icons.

## What this guide does not do

Connecting the GitHub repository, assigning the domains, or starting a Vercel deployment is a later approval. The production API and MCP hosts are not reachable until DNS and VPS TLS exist.
