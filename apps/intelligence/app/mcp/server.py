import asyncio
import json
import logging
import time
from collections.abc import Awaitable
from typing import Annotated

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field, ValidationError

from app.api.deps import check_mcp_tool_limit, current_mcp_auth
from app.core.config import get_settings
from app.schemas.envelope import EvidenceEnvelope
from app.schemas.tools import (
    AnalyzeAssetInput,
    AnalyzeMomentumInput,
    CompareAssetsInput,
    DerivativesAnalysisInput,
    DetectAnomaliesInput,
    HistoricalPerformanceInput,
    RankBy,
    ScanMoversInput,
    SectorRotationInput,
    SectorSlug,
)
from app.services import intelligence as workflows
from app.services.evidence import EvidenceWriter, RequestLog, SupabaseEvidenceWriter
from app.services.intelligence import ServiceDeps

logger = logging.getLogger("cointrac")


class CoinTracMCPServer(MCPServer):
    """MCP server that advertises only canonical `cointrac://*` resources."""


mcp = CoinTracMCPServer("CoinTrac Market Intelligence")
_deps: ServiceDeps | None = None
_writer: EvidenceWriter | None = None


def set_service_deps(deps: ServiceDeps | None) -> None:
    global _deps
    _deps = deps


def set_evidence_writer(writer: EvidenceWriter | None) -> None:
    global _writer
    _writer = writer


def _evidence_writer() -> EvidenceWriter:
    return _writer if _writer is not None else SupabaseEvidenceWriter()


def _format_validation_error(tool_name: str, exc: ValidationError) -> str:
    parts: list[str] = []
    for err in exc.errors():
        loc = ".".join(str(piece) for piece in err.get("loc", ()))
        msg = str(err.get("msg", "invalid value"))
        parts.append(f"{loc}: {msg}" if loc else msg)
    summary = "; ".join(parts) if parts else "invalid arguments"
    return f"Invalid input for {tool_name}: {summary}"


def _build_input[M: BaseModel](model_cls: type[M], tool_name: str, **kwargs: object) -> M:
    try:
        return model_cls(**kwargs)
    except ValidationError as exc:
        raise ToolError(_format_validation_error(tool_name, exc)) from None


async def _tracked(name: str, awaitable: Awaitable[EvidenceEnvelope]) -> dict[str, object]:
    record = current_mcp_auth.get()
    if record is not None:
        retry_after = await check_mcp_tool_limit(record)
        if retry_after is not None:
            close = getattr(awaitable, "close", None)
            if callable(close):
                close()
            raise ToolError(
                f"Rate limit exceeded for tool '{name}'. Retry after {retry_after} seconds."
            )
    started = time.perf_counter()
    status_code = 200
    evidence_id: str | None = None
    cache_hit = False
    credit_cost = 0
    timeout_seconds = get_settings().mcp_tool_timeout_seconds
    try:
        envelope = await asyncio.wait_for(awaitable, timeout=timeout_seconds)
        payload = envelope.model_dump(mode="json")
        evidence = payload["evidence"]
        evidence_id = str(evidence["evidence_id"])
        cache_hit = bool(evidence["cache_hit"])
        credit_cost = int(evidence["cmc_credit_cost"])
        return payload
    except TimeoutError:
        status_code = 504
        logger.warning("mcp tool timeout tool=%s timeout_s=%.1f", name, timeout_seconds)
        raise ToolError(
            f"Tool '{name}' timed out after {timeout_seconds:.0f}s. Please retry."
        ) from None
    except ToolError:
        status_code = 400
        raise
    except Exception as exc:
        status_code = 500
        logger.warning("mcp tool internal error tool=%s error_type=%s", name, type(exc).__name__)
        raise ToolError(
            f"Tool '{name}' encountered an internal error. Please retry later."
        ) from None
    finally:
        latency_ms = int((time.perf_counter() - started) * 1000)
        try:
            await _evidence_writer().log_request(
                RequestLog(
                    api_key_id=record.key_id if record is not None else None,
                    user_id=record.user_id if record is not None else None,
                    surface="mcp",
                    tool_name=name,
                    status_code=status_code,
                    latency_ms=latency_ms,
                    cache_hit=cache_hit,
                    credit_cost=credit_cost,
                    evidence_id=evidence_id,
                )
            )
        except Exception:
            logger.info("mcp request log skipped tool=%s", name)


@mcp.tool(
    description=(
        "Use for a macro snapshot (total market cap, BTC/ETH dominance, Fear & Greed, "
        "top gainers/losers). Do NOT use if the user specifically asks for a regime "
        "classification label -> use `analyze_market_regime`. Always check `status` "
        "(OK/PARTIAL/INSUFFICIENT_DATA), `evidence.freshness`, and `limitations`."
    )
)
async def get_market_overview(
    quote_currency: Annotated[
        str,
        Field(
            description=(
                "Fiat or crypto quote currency code for market cap, volume, and prices "
                "(ISO/CMC ticker, e.g. 'USD', 'EUR', 'BTC'). Default: 'USD'."
            ),
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
) -> dict[str, object]:
    """Macro snapshot."""
    return await _tracked(
        "get_market_overview",
        workflows.get_market_overview(quote_currency.strip().upper() or "USD", deps=_deps),
    )


@mcp.tool(
    description=(
        "Use to classify the current market regime (`RISK_ON_ALTSEASON`, "
        "`BTC_LED_EXPANSION`, `RISK_OFF_STRESS`, `RANGE_CONSOLIDATION`) "
        "with deterministic indicator scores and rationale. Check `limitations` and "
        "`evidence.freshness` before citing."
    )
)
async def analyze_market_regime(
    quote_currency: Annotated[
        str,
        Field(
            description=(
                "Quote currency code for macro market-cap metrics (e.g. 'USD'). Default: 'USD'."
            ),
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
) -> dict[str, object]:
    """Regime classification."""
    return await _tracked(
        "analyze_market_regime",
        workflows.analyze_market_regime(
            deps=_deps,
            quote_currency=quote_currency.strip().upper() or "USD",
        ),
    )


@mcp.tool(
    description=(
        "Use for rule-based screening/filtering (e.g., high momentum, minimum liquidity, "
        "anti-chase max 24h gain). Do NOT use for statistical outlier detection -> "
        "use `detect_market_anomalies`. Missing filter metrics exclude candidates; "
        "returns INSUFFICIENT_DATA if zero assets match."
    )
)
async def scan_market_movers(
    quote_currency: Annotated[
        str,
        Field(
            description="Quote currency code for price, market cap, and volume (default: 'USD').",
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
    min_market_cap_usd: Annotated[
        float | None,
        Field(
            description=(
                "Optional minimum market capitalization floor in quote currency units "
                "(e.g. 100000000 for $100M USD). Omit or null for no floor."
            ),
            ge=0,
        ),
    ] = None,
    min_volume_24h_usd: Annotated[
        float | None,
        Field(
            description=(
                "Optional minimum 24-hour spot volume floor in quote currency units "
                "(e.g. 10000000 for $10M USD). Omit or null for no floor."
            ),
            ge=0,
        ),
    ] = None,
    min_vol_to_mcap: Annotated[
        float | None,
        Field(
            description=(
                "Optional minimum 24h volume-to-market-cap ratio as a decimal "
                "(e.g. 0.05 means 5% daily turnover, NOT 5). Omit or null for no floor."
            ),
            ge=0,
        ),
    ] = None,
    min_rs_vs_btc_7d: Annotated[
        float | None,
        Field(
            description=(
                "Optional minimum 7-day relative strength vs BTC in percentage points "
                "(asset 7d % minus BTC 7d %, e.g. 0.0 for outperforming BTC)."
            ),
        ),
    ] = None,
    max_24h_gain_pct: Annotated[
        float | None,
        Field(
            description=(
                "Optional anti-chase ceiling on 24h percent change in percentage points "
                "(e.g. 20.0 excludes assets already up >20% in 24h)."
            ),
        ),
    ] = None,
    max_7d_gain_pct: Annotated[
        float | None,
        Field(
            description=(
                "Optional multi-horizon anti-chase ceiling on 7d percent change in percentage "
                "points (-100.0 to 10000.0; e.g. 40.0 excludes assets already up >40% in 7d). "
                "Omit or null to disable."
            ),
            ge=-100.0,
            le=10000.0,
        ),
    ] = None,
    rank_by: Annotated[
        RankBy,
        Field(
            description=(
                "Ranking metric for matching assets: 'composite_momentum_score', "
                "'rs_vs_btc_7d', or 'volume_to_mcap'. Default: 'composite_momentum_score'."
            ),
        ),
    ] = "composite_momentum_score",
    limit: Annotated[
        int,
        Field(
            description="Maximum number of ranked movers to return (integer, 1–50). Default: 20.",
            ge=1,
            le=50,
        ),
    ] = 20,
    universe_size: Annotated[
        int,
        Field(
            description="Top market-cap listings count to screen (integer, 10–200). Default: 150.",
            ge=10,
            le=200,
        ),
    ] = 150,
) -> dict[str, object]:
    """Rule-based mover screen."""
    params = _build_input(
        ScanMoversInput,
        "scan_market_movers",
        quote_currency=quote_currency,
        min_market_cap_usd=min_market_cap_usd,
        min_volume_24h_usd=min_volume_24h_usd,
        min_vol_to_mcap=min_vol_to_mcap,
        min_rs_vs_btc_7d=min_rs_vs_btc_7d,
        max_24h_gain_pct=max_24h_gain_pct,
        max_7d_gain_pct=max_7d_gain_pct,
        rank_by=rank_by,
        limit=limit,
        universe_size=universe_size,
    )
    return await _tracked("scan_market_movers", workflows.scan_market_movers(params, deps=_deps))


@mcp.tool(
    description=(
        "Use to discover statistical outliers (volume-to-mcap Z-score/MAD spikes "
        "and strong >=8% opposite-sign 24h BTC divergences) across top listings."
    )
)
async def detect_market_anomalies(
    quote_currency: Annotated[
        str,
        Field(
            description="Quote currency code for listings quotes (e.g. 'USD'). Default: 'USD'.",
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
    universe_size: Annotated[
        int,
        Field(
            description="Top market-cap listings count to scan (integer, 10–200). Default: 150.",
            ge=10,
            le=200,
        ),
    ] = 150,
) -> dict[str, object]:
    """Statistical outlier scan."""
    params = _build_input(
        DetectAnomaliesInput,
        "detect_market_anomalies",
        quote_currency=quote_currency,
        universe_size=universe_size,
    )
    return await _tracked(
        "detect_market_anomalies",
        workflows.detect_market_anomalies(params, deps=_deps),
    )


@mcp.tool(
    description=(
        "Use to compare 2–8 cryptocurrencies side-by-side on liquidity, FDV ratio, "
        "momentum, relative strength vs BTC, and 365d volatility when OHLCV is available. "
        "Check `limitations` for tier-restricted historical metrics."
    )
)
async def compare_assets(
    symbols: Annotated[
        list[str],
        Field(
            description=(
                "List of 2 to 8 unique cryptocurrency ticker symbols (1–20 uppercase "
                "alphanumeric chars each, e.g. ['SOL', 'AVAX', 'NEAR'])."
            ),
            min_length=2,
            max_length=8,
        ),
    ],
    quote_currency: Annotated[
        str,
        Field(
            description="Quote currency code for comparison metrics (e.g. 'USD'). Default: 'USD'.",
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
) -> dict[str, object]:
    """Side-by-side asset comparison."""
    params = _build_input(
        CompareAssetsInput,
        "compare_assets",
        symbols=symbols,
        quote_currency=quote_currency,
    )
    return await _tracked("compare_assets", workflows.compare_assets(params, deps=_deps))


@mcp.tool(
    description=(
        "Use for deep single-asset market fundamentals, canonical CMC ID, supply dynamics, "
        "tags/sector, relative strength vs BTC, and historical risk when plan permits. "
        "Check `status` and `limitations` when OHLCV or price-performance endpoints are restricted."
    )
)
async def analyze_asset(
    symbol: Annotated[
        str,
        Field(
            description=(
                "Single cryptocurrency ticker symbol (1–20 alphanumeric chars, e.g. 'SOL', "
                "'BTC'). Resolved canonically to numeric CMC ID via market_assets."
            ),
            min_length=1,
            max_length=20,
        ),
    ],
    quote_currency: Annotated[
        str,
        Field(
            description=(
                "Quote currency code for price, cap, and volume (e.g. 'USD'). Default: 'USD'."
            ),
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
) -> dict[str, object]:
    """Single-asset profile."""
    params = _build_input(
        AnalyzeAssetInput,
        "analyze_asset",
        symbol=symbol,
        quote_currency=quote_currency,
    )
    return await _tracked("analyze_asset", workflows.analyze_asset(params, deps=_deps))


@mcp.tool(
    description=(
        "Use for multi-timeframe momentum decomposition (1h, 24h, 7d, 30d, 60d, 90d), "
        "RS vs BTC, and 7d-vs-30d acceleration across 1–20 specific tickers."
    )
)
async def analyze_momentum(
    symbols: Annotated[
        list[str],
        Field(
            description=(
                "List of 1 to 20 unique cryptocurrency ticker symbols (1–20 alphanumeric "
                "chars each, e.g. ['BTC', 'ETH', 'SOL'])."
            ),
            min_length=1,
            max_length=20,
        ),
    ],
    quote_currency: Annotated[
        str,
        Field(
            description="Quote currency code for quote returns (e.g. 'USD'). Default: 'USD'.",
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
) -> dict[str, object]:
    """Multi-timeframe momentum."""
    params = _build_input(
        AnalyzeMomentumInput,
        "analyze_momentum",
        symbols=symbols,
        quote_currency=quote_currency,
    )
    return await _tracked("analyze_momentum", workflows.analyze_momentum(params, deps=_deps))


@mcp.tool(
    description=(
        "Use to compare aggregate performance, breadth, and volume rotation across "
        "canonical crypto sectors (defi, ai-big-data, layer-1, layer-2, gaming, rwa, memes). "
        "Inspect constituent_count and limitations for thin-sample sectors."
    )
)
async def analyze_sector_rotation(
    quote_currency: Annotated[
        str,
        Field(
            description=(
                "Quote currency code for sector cap/volume metrics (e.g. 'USD'). Default: 'USD'."
            ),
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
    sectors: Annotated[
        list[SectorSlug] | None,
        Field(
            description=(
                "Optional subset of canonical sector slugs to evaluate: 'defi', 'ai-big-data', "
                "'layer-1', 'layer-2', 'gaming', 'rwa', 'memes'. Omit or null for all 7 sectors."
            ),
        ),
    ] = None,
) -> dict[str, object]:
    """Sector breadth and rotation."""
    params = _build_input(
        SectorRotationInput,
        "analyze_sector_rotation",
        quote_currency=quote_currency,
        sectors=sectors,
    )
    return await _tracked(
        "analyze_sector_rotation",
        workflows.analyze_sector_rotation(params, deps=_deps),
    )


@mcp.tool(
    description=(
        "Use for daily time-series return statistics, 365-day annualized volatility, "
        "max drawdown, beta, and Pearson correlation vs BTC. Returns TIER_RESTRICTED "
        "with null risk metrics if the active CMC key lacks historical OHLCV access."
    )
)
async def get_historical_performance(
    symbol: Annotated[
        str,
        Field(
            description=(
                "Single cryptocurrency ticker symbol (1–20 alphanumeric chars, e.g. 'SOL')."
            ),
            min_length=1,
            max_length=20,
        ),
    ],
    quote_currency: Annotated[
        str,
        Field(
            description="Quote currency code for daily OHLCV closes (e.g. 'USD'). Default: 'USD'.",
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
    count: Annotated[
        int,
        Field(
            description="Number of daily UTC close candles to fetch (integer, 5–90). Default: 30.",
            ge=5,
            le=90,
        ),
    ] = 30,
) -> dict[str, object]:
    """Historical risk versus BTC."""
    params = _build_input(
        HistoricalPerformanceInput,
        "get_historical_performance",
        symbol=symbol,
        quote_currency=quote_currency,
        count=count,
    )
    return await _tracked(
        "get_historical_performance",
        workflows.get_historical_performance(params, deps=_deps),
    )


@mcp.tool(
    description=(
        "Use to inspect CMC v5 derivatives market pairs (per-pair open interest, funding "
        "rates, exclusions, outlier flags, and sampled non-outlier open interest sum), or "
        "transparent spot-stress proxy when derivatives endpoints are unavailable. Returns "
        "PARTIAL when only a top-N pair subset or unaggregated funding rates are available."
    )
)
async def analyze_derivatives(
    symbol: Annotated[
        str,
        Field(
            description=(
                "Single cryptocurrency ticker symbol (1–20 alphanumeric chars, e.g. 'BTC')."
            ),
            min_length=1,
            max_length=20,
        ),
    ],
    quote_currency: Annotated[
        str,
        Field(
            description=(
                "Quote currency code for USD-notional open interest (e.g. 'USD'). Default: 'USD'."
            ),
            min_length=2,
            max_length=10,
        ),
    ] = "USD",
) -> dict[str, object]:
    """Derivatives or spot-stress proxy."""
    params = _build_input(
        DerivativesAnalysisInput,
        "analyze_derivatives",
        symbol=symbol,
        quote_currency=quote_currency,
    )
    return await _tracked(
        "analyze_derivatives",
        workflows.analyze_derivatives(params, deps=_deps),
    )


@mcp.resource("cointrac://market/overview", mime_type="application/json")
async def market_overview_resource() -> str:
    payload = await _tracked("get_market_overview", workflows.get_market_overview(deps=_deps))
    return json.dumps(payload)


@mcp.resource("cointrac://market/trending", mime_type="application/json")
async def market_trending_resource() -> str:
    params = ScanMoversInput(limit=10, max_24h_gain_pct=25)
    payload = await _tracked("scan_market_movers", workflows.scan_market_movers(params, deps=_deps))
    return json.dumps(payload)


@mcp.resource("cointrac://market/sectors", mime_type="application/json")
async def market_sectors_resource() -> str:
    payload = await _tracked(
        "analyze_sector_rotation",
        workflows.analyze_sector_rotation(deps=_deps),
    )
    return json.dumps(payload)


@mcp.resource("cointrac://assets/{symbol}/profile", mime_type="application/json")
async def asset_profile_resource(symbol: str) -> str:
    params = AnalyzeAssetInput(symbol=symbol)
    payload = await _tracked("analyze_asset", workflows.analyze_asset(params, deps=_deps))
    return json.dumps(payload)


@mcp.resource("cointrac://evidence/{evidence_id}", mime_type="application/json")
async def evidence_resource(evidence_id: str) -> str:
    record = current_mcp_auth.get()
    started = time.perf_counter()
    status_code = 200
    if record is not None:
        retry_after = await check_mcp_tool_limit(record)
        if retry_after is not None:
            status_code = 429
            try:
                await _evidence_writer().log_request(
                    RequestLog(
                        api_key_id=record.key_id,
                        user_id=record.user_id,
                        surface="mcp",
                        tool_name="resource:evidence",
                        status_code=status_code,
                        latency_ms=int((time.perf_counter() - started) * 1000),
                        cache_hit=False,
                        credit_cost=0,
                        evidence_id=evidence_id,
                    )
                )
            except Exception:
                logger.info("mcp evidence resource log skipped")
            return json.dumps(
                {
                    "evidence_id": evidence_id,
                    "status": "INSUFFICIENT_DATA",
                    "limitations": [
                        f"Rate limit exceeded. Retry after {retry_after} seconds.",
                    ],
                }
            )
    payload = await _read_evidence(evidence_id)
    if payload.get("status") == "INSUFFICIENT_DATA":
        status_code = 404
    try:
        await _evidence_writer().log_request(
            RequestLog(
                api_key_id=record.key_id if record is not None else None,
                user_id=record.user_id if record is not None else None,
                surface="mcp",
                tool_name="resource:evidence",
                status_code=status_code,
                latency_ms=int((time.perf_counter() - started) * 1000),
                cache_hit=False,
                credit_cost=0,
                evidence_id=evidence_id if status_code == 200 else None,
            )
        )
    except Exception:
        logger.info("mcp evidence resource log skipped")
    return json.dumps(payload)


@mcp.prompt(name="daily-market-briefing")
def daily_market_briefing() -> str:
    """Ask the client to brief the market and cite every evidence record."""
    return (
        "Call get_market_overview, analyze_market_regime, and analyze_sector_rotation. "
        "Present a structured, factual briefing and cite every evidence_id with its UTC timestamp. "
        "Keep missing numbers null, include all limitations, explicitly highlight any regime "
        "signal_conflict or low-sample sector INSUFFICIENT_DATA flags, and do NOT give "
        "buy/sell investment advice or unsupported trade recommendations."
    )


@mcp.prompt(name="asset-due-diligence")
def asset_due_diligence(symbol: str, peers: str) -> str:
    """Ask the client to research one asset against named peers."""
    return (
        f"Call analyze_asset for {symbol}, compare_assets for {symbol} and {peers}, "
        "and get_historical_performance for the same symbol. "
        "Highlight liquidity, FDV overhang, timeframe coverage, and every data limitation with "
        "its evidence_id. Remain descriptive and factual; do NOT invent buy/sell recommendations "
        "or price targets."
    )


@mcp.prompt(name="market-risk-review")
def market_risk_review(symbols: str) -> str:
    """Ask the client for a risk-first review of the named symbols."""
    return (
        "Call analyze_market_regime, detect_market_anomalies, and "
        f"analyze_derivatives for {symbols}. "
        "Lead with risks, cite every evidence_id, explicitly note regime conflicts, partial "
        "pair sampling, unaggregated funding rates, or spot-proxy fallbacks, and do NOT give "
        "personalized trading or financial advice."
    )


async def _read_evidence(evidence_id: str) -> dict[str, object]:
    from app.api.deps import current_mcp_auth

    record = current_mcp_auth.get()
    owner = record.user_id if record is not None else None
    if not owner:
        return {
            "evidence_id": evidence_id,
            "status": "INSUFFICIENT_DATA",
            "limitations": [f"{evidence_id} was not found."],
        }
    try:
        from app.core.db import supabase_client

        response = await _query_evidence(supabase_client(), evidence_id, owner)
    except Exception:
        return {
            "evidence_id": evidence_id,
            "status": "INSUFFICIENT_DATA",
            "limitations": ["The evidence record is not available."],
        }
    if response is None:
        return {
            "evidence_id": evidence_id,
            "status": "INSUFFICIENT_DATA",
            "limitations": [f"{evidence_id} was not found."],
        }
    return response


async def _query_evidence(
    client: object,
    evidence_id: str,
    owner_id: str,
) -> dict[str, object] | None:
    if not owner_id:
        raise ValueError("evidence owner is required")
    import asyncio

    def read() -> dict[str, object] | None:
        table = client.table("evidence_records")  # type: ignore[attr-defined]
        response = (
            table.select("*")
            .eq("evidence_id", evidence_id)
            .eq("user_id", owner_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            return None
        row = dict(rows[0])
        row.pop("raw_excerpt", None)
        methodology = row.get("methodology")
        limitations = row.get("limitations")
        if (
            isinstance(methodology, dict) and methodology.get("actual_data_mode") == "UNAVAILABLE"
        ) or (
            row.get("credit_cost") == 0
            and isinstance(limitations, list)
            and "No CoinMarketCap payload was available." in limitations
        ):
            row["data_mode"] = "UNAVAILABLE"
        return {key: _jsonable(value) for key, value in row.items() if key != "api_key"}

    return await asyncio.to_thread(read)


def _jsonable(value: object) -> object:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
