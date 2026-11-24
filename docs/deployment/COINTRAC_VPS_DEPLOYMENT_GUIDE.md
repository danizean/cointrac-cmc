# CoinTrac VPS deployment guide

The VPS runs only the FastAPI and MCP process. The Next.js site stays on Vercel.

Verified and unchanged host facts from the read-only audit:

- Ubuntu 24.04.5 LTS, public address `43.133.139.3`
- About 2 vCPU, 1.9 GiB RAM, about 2 GiB swap, about 30 GiB disk free
- Docker and Docker Compose already installed
- Nginx is active on port 80
- Caddy is not installed
- No containers or images were present
- TCP 443 was not reachable
- SSH root login and password authentication were enabled
- UFW was inactive

Do not stop Nginx, change SSH, change the firewall, or install packages until that work is separately authorized.

## Process layout

`docker-compose.vps.yml` starts one service:

- Image: `ghcr.io/danizean/cointrac-cmc/intelligence:latest`
- Build context, when a local build is unavoidable: repository root, file `apps/intelligence/Dockerfile`
- Network mode: `host`
- Listen address: `127.0.0.1:8000` only
- Proxy trust: `--proxy-headers --forwarded-allow-ips 127.0.0.1`
- Memory limit: 768 MiB, plus swap headroom up to 1536 MiB
- CPU limit: 1.0
- Logs: json-file, 10 MiB, 3 files
- User inside the image: `cointrac` uid 10001
- Health check: `GET http://127.0.0.1:8000/health`

Host networking is intentional. Nginx on the host connects to loopback, and the container sees that peer as `127.0.0.1`, so the forwarded-header allow list stays narrow. Ports 3000 and 8000 are not published on the public interface.

The image build context is the repository root because the runtime copy includes `docs/CMC_CAPABILITY_MATRIX.json`. The Dockerfile does not copy `.env`.

Build the image in GitHub Actions with `.github/workflows/intelligence-image.yml`. A pull request only builds. Publishing to GHCR happens on a manual `workflow_dispatch` and has not been run. On a 1.9 GiB host, pull that image instead of building Next.js and FastAPI together on the VPS.

```bash
docker compose -f docker-compose.vps.yml pull
docker compose -f docker-compose.vps.yml up -d
```

`pull` fails until the manual workflow has published an image. That is expected today.

## Environment on the host

Create a host `.env` from `.env.example`. The compose file reads it and does not bake it into the image. Set at least:

| Name | Role |
|---|---|
| `CMC_API_KEY` | Server-only CoinMarketCap credential |
| `CMC_BASE_URL` | `https://pro-api.coinmarketcap.com` |
| `SUPABASE_URL` | Allowed Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only |
| `SANDBOX_API_KEY` | Server-only `ct_live_` key, if the server playground path needs it |
| `ENGINE_VERSION` | `cointrac-intelligence-v1.0.0` |

The compose file sets these non-secret routing values itself:

- `CORS_ORIGINS=https://cointrac.xyz,https://www.cointrac.xyz`
- `TRUSTED_HOSTS=api.cointrac.xyz,mcp.cointrac.xyz,localhost,127.0.0.1`
- `PUBLIC_API_BASE_URL=https://api.cointrac.xyz`
- `REMOTE_MCP_PUBLIC_URL=https://mcp.cointrac.xyz/mcp`
- MCP allowed hosts include `api.cointrac.xyz` and `mcp.cointrac.xyz`
- MCP allowed origins include the two site origins and local development origins

Empty `TRUSTED_HOSTS` leaves the host check off for local development. A wildcard CORS origin or trusted host is rejected at startup. Authentication and API key checks are unchanged.

## Nginx routing

Keep the current Nginx process. Add two server names later, both proxying to `http://127.0.0.1:8000`, with WebSocket and long-read settings because MCP is Streamable HTTP on the same app:

```nginx
server {
    listen 443 ssl;
    server_name api.cointrac.xyz mcp.cointrac.xyz;

    # Certificate paths come from the later TLS install. Do not invent them here.

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

Public paths after that proxy exists:

- REST base: `https://api.cointrac.xyz`
- Health: `https://api.cointrac.xyz/health`
- OpenAPI UI: `https://api.cointrac.xyz/docs`
- MCP: `https://mcp.cointrac.xyz/mcp` and `https://mcp.cointrac.xyz/mcp/`

There is no separate MCP process and no prefix rewrite. A client that uses `https://mcp.cointrac.xyz` without `/mcp` is not a valid endpoint.

## Still required on the host

These items block a safe public deployment. This repository does not perform them.

1. Make IDwebhost answer for the zone, then add the A records.
2. Issue certificates and attach them to the existing Nginx. Port 443 was closed at audit time.
3. Restrict SSH root login and password authentication, then enable a firewall that still allows the required HTTP ports.
4. Publish the intelligence image, copy the host `.env`, and start the compose file.
5. Confirm `GET /health` on loopback returns `engine_version` `cointrac-intelligence-v1.0.0` before opening the proxy.
