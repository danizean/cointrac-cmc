# TradeGuard agent guardrails

These rules apply to every change in this repository.

## Global rules

1. **Sequential gate execution.** Complete only one implementation step per session. Do not start the next step until every command in the current step's verification gate exits with code 0.
2. **Single source of truth.** MCP tools (`apps/intelligence/app/mcp/server.py`) and REST endpoints (`apps/intelligence/app/api/v1/router.py`) must call the same async functions in `apps/intelligence/app/services/intelligence.py`. Do not duplicate business logic.
3. **Pure quantitative functions.** Code in `apps/intelligence/app/quant/` is side-effect free: no network calls and no database calls.
4. **Honest missing data.** Missing market data stays `null` / `None` and is listed in `limitations`. Never turn a missing price, volume, or return into `0`.
5. **Canonical identifiers.** Resolve assets to the CoinMarketCap numeric `cmc_id` through `market_assets`. Do not assume ticker symbols are unique.
6. **Mandatory evidence envelope.** Every intelligence tool and REST endpoint returns `EvidenceEnvelope[T]` and persists an audit row in `evidence_records`.
7. **Crypto annualization.** Daily-return volatility uses `sqrt(365)`, never `sqrt(252)`.
8. **Code quality.** Python uses Ruff and strict Pydantic v2. Next.js uses `tsc --noEmit` and ESLint.
9. **Secrets.** Never commit `.env`, `CMC_API_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`. Never send `CMC_API_KEY` to the browser bundle. The Next.js app talks to FastAPI through the server-side proxy.
10. **No server-side LLM calls.** Analytics, screening, anomaly detection, and regime classification are deterministic Python.

## Evidence envelope

Every MCP tool and REST intelligence response uses this shape:

- `tool`, `engine_version`, `status`, `summary`, `data`
- `methodology`: `metrics`, `observation_window`, `annualization_basis` (`365d`)
- `evidence`: `evidence_id`, `data_mode`, `freshness`, `retrieved_at_utc`, `source_timestamps`, `cmc_endpoints_called`, `cmc_credit_cost`, `cache_hit`
- `limitations`

Allowed values:

- `status`: `OK` | `PARTIAL` | `TIER_RESTRICTED` | `INSUFFICIENT_DATA`
- `evidence.data_mode`: `LIVE` | `CACHED` | `VERIFIED_SNAPSHOT_FALLBACK`
- `evidence.freshness`: `FRESH` | `AGING` | `STALE`

Next.js agent notes for the web app live in `apps/web/AGENTS.md`.

## Next.js 16

The research guide mentions Next.js 15. This app is Next.js 16 with App Router under `apps/web/src/app`. Follow the installed Next.js docs when they differ from that guide.

- Keep `cacheComponents` and `partialPrefetching` enabled together.
- Do not export `runtime`, `dynamic`, `revalidate`, or `fetchCache` from a route segment.
- Server Components are the default. Add `"use client"` only on a leaf that needs browser state.
- Live market data renders inside `<Suspense>`. Do not block the static shell on it, and do not replace a missing value with `0`.
- The browser calls `/api/tg/*` only. That route may reach `health` and `v1` on the intelligence API, attaches `SANDBOX_API_KEY` on the server, and forwards `x-cmc-api-key` only in memory. Never read `CMC_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in `apps/web`, and do not create `NEXT_PUBLIC_SANDBOX_API_KEY`.
- Visual rules live in `design-system/tradeguard/MASTER.md`. Use the semantic tokens in `apps/web/src/app/globals.css`. Do not add a second palette or a Tailwind v3 config.
