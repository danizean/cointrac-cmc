# CoinTrac domain and DNS setup

This document records the intended DNS layout. It does not change nameservers or records.

Last reviewed: 2026-11-24. The read-only VPS audit findings below are unchanged unless a later authorized check says otherwise.

## Current DNS blocker

`cointrac.xyz` and `www.cointrac.xyz` returned **SERVFAIL** during the audit. The parent delegation points at `ns1.idwebhost.id` and `ns2.idwebhost.id`, and both nameservers returned **REFUSED**.

No A, AAAA, or CNAME record will propagate until IDwebhost answers for this zone. Fix the zone or the nameserver delegation in the IDwebhost control panel before adding the records below. Do not switch nameservers from this repository.

## Where each name is served

| Name | Serves | Configured in |
|---|---|---|
| `cointrac.xyz` | Next.js site and `/app` dashboard | Vercel Hobby project, root directory `apps/web` |
| `www.cointrac.xyz` | Redirects to `https://cointrac.xyz` | Same Vercel project, plus the host redirect in `apps/web/next.config.ts` |
| `api.cointrac.xyz` | FastAPI REST | VPS `43.133.139.3`, existing Nginx, loopback container |
| `mcp.cointrac.xyz` | Same FastAPI process, MCP path `/mcp` | VPS `43.133.139.3`, existing Nginx, loopback container |

The Next.js app is not part of the VPS compose file. Nginx already listens on port 80. Leave it running. Do not install Caddy or stop Nginx as part of repository preparation.

## Records to create at IDwebhost

Copy the Vercel values from the project domain screen after the zone answers. Do not guess them.

| Type | Host | Value | Source |
|---|---|---|---|
| A | `@` | Vercel-provided IPv4 | Vercel domain settings for `cointrac.xyz` |
| CNAME | `www` | Vercel-provided canonical target | Vercel domain settings for `www.cointrac.xyz` |
| A | `api` | `43.133.139.3` | Verified VPS public address |
| A | `mcp` | `43.133.139.3` | Verified VPS public address |

Do not add an AAAA record unless Vercel or the VPS shows a real IPv6 address. A stale AAAA record can send clients to an unreachable address.

## Check authoritative nameservers

From a machine that has `dig`:

```bash
dig NS cointrac.xyz +short
dig SOA cointrac.xyz @ns1.idwebhost.id
dig SOA cointrac.xyz @ns2.idwebhost.id
dig A cointrac.xyz @ns1.idwebhost.id
dig CNAME www.cointrac.xyz @ns1.idwebhost.id
dig A api.cointrac.xyz @ns1.idwebhost.id
dig A mcp.cointrac.xyz @ns1.idwebhost.id
dig AAAA cointrac.xyz @ns1.idwebhost.id
```

On Windows PowerShell:

```powershell
Resolve-DnsName cointrac.xyz -Type NS
Resolve-DnsName cointrac.xyz -Type A -Server ns1.idwebhost.id
Resolve-DnsName www.cointrac.xyz -Type CNAME -Server ns1.idwebhost.id
Resolve-DnsName api.cointrac.xyz -Type A -Server ns1.idwebhost.id
Resolve-DnsName mcp.cointrac.xyz -Type A -Server ns1.idwebhost.id
```

The zone is ready for records only when the SOA query returns a serial instead of REFUSED or SERVFAIL. Public resolvers can lag the authoritative servers. Compare the authoritative answer with `1.1.1.1` before calling propagation done.

## HTTPS after DNS works

- Vercel issues the certificate for `cointrac.xyz` and `www.cointrac.xyz` after those names point at the targets Vercel displays. Confirm the project shows the domains as valid.
- The VPS had no listener on TCP 443 during the audit. Nginx on port 80 cannot serve the API or MCP over HTTPS until a certificate is installed on that existing Nginx. That install is a later, separately authorized change. Repository preparation does not request a certificate and does not open ports.

A correct check after certificates exist:

```bash
curl -I https://cointrac.xyz
curl -I https://www.cointrac.xyz
curl -fsS https://api.cointrac.xyz/health
curl -I https://mcp.cointrac.xyz/mcp
```

`https://www.cointrac.xyz` should redirect to `https://cointrac.xyz`. `GET /mcp` without a CoinTrac key should be rejected with 401. That rejection means the endpoint is present. It is not a successful tool call.
