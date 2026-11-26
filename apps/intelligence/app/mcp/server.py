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


mcp = CoinTracMCPServer(
    "CoinTrac Market Intelligence",
    instructions=(
        "Pilih tool dari tugas pengguna. get_market_overview untuk snapshot makro; "
        "analyze_market_regime untuk label regime; scan_market_movers untuk filter; "
        "detect_market_anomalies untuk outlier; compare_assets untuk 2-8 aset; "
        "analyze_asset untuk satu aset; analyze_momentum untuk beberapa ticker; "
        "analyze_sector_rotation untuk sektor; get_historical_performance untuk risiko "
        "historis; analyze_derivatives untuk derivatif. Panggil get_capabilities dulu "
        "bila perlu tahu tier, persentase budget, dan tool yang sedang fallback. "
        "Jangan sebut data sebagai realtime. Angka yang hilang tetap null."
    ),
)
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


def _validated_quote(tool_name: str, quote_currency: str) -> str:
    from app.schemas.tools import validate_quote_currency

    try:
        return validate_quote_currency(quote_currency)
    except ValueError as exc:
        raise ToolError(f"Invalid input for {tool_name}: quote_currency: {exc}") from None


async def _tracked(name: str, awaitable: Awaitable[EvidenceEnvelope]) -> dict[str, object]:
    record = current_mcp_auth.get()
    if record is not None:
        retry_after = await check_mcp_tool_limit(record)
        if retry_after is not None:
            close = getattr(awaitable, "close", None)
            if callable(close):
                close()
            raise ToolError(
                f"Rate limit exceeded for tool '{name}'. Retry after {retry_after} seconds. "
                f"retry_after_seconds={retry_after} suggested_tool=get_capabilities"
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
                    api_key_id=record.persisted_key_id if record is not None else None,
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
        "Pakai tool ini untuk melihat tier, persentase budget, dan tool yang full atau fallback. "
        "Jangan pakai untuk harga atau analisis pasar. Tidak butuh input dan tidak memanggil CMC."
    )
)
async def get_capabilities() -> dict[str, object]:
    """Budget and tool mode. Zero CoinMarketCap credits."""
    return await _tracked("get_capabilities", workflows.get_capabilities(deps=_deps))


@mcp.tool(
    description=(
        "Pakai tool ini untuk snapshot makro (market cap, dominasi, Fear and Greed). "
        "Jangan pakai untuk label regime. Butuh input quote_currency opsional."
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
    validated_quote = _validated_quote("get_market_overview", quote_currency)
    return await _tracked(
        "get_market_overview",
        workflows.get_market_overview(validated_quote, deps=_deps),
    )


@mcp.tool(
    description=(
        "Pakai tool ini untuk label regime deterministik. "
        "Jangan pakai untuk daftar koin yang naik. Butuh input quote_currency opsional."
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
    validated_quote = _validated_quote("analyze_market_regime", quote_currency)
    return await _tracked(
        "analyze_market_regime",
        workflows.analyze_market_regime(
            deps=_deps,
            quote_currency=validated_quote,
        ),
    )


@mcp.tool(
    description=(
        "Pakai tool ini untuk menyaring mover dengan aturan likuiditas dan momentum. "
        "Jangan pakai untuk outlier statistik. Butuh input filter opsional dan universe_size."
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
    deep_scan: Annotated[
        bool,
        Field(
            description=(
                "Optional. Page listings up to 1000 only when the effective profile is startup "
                "and the budget is NORMAL. Otherwise the request stays on universe_size."
            ),
        ),
    ] = False,
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
        deep_scan=deep_scan,
    )
    return await _tracked("scan_market_movers", workflows.scan_market_movers(params, deps=_deps))


@mcp.tool(
    description=(
        "Pakai tool ini untuk outlier volume dan divergensi terhadap BTC. "
        "Jangan pakai untuk filter momentum biasa. Butuh input universe_size opsional."
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
    deep_scan: Annotated[
        bool,
        Field(
            description=(
                "Optional. Page listings up to 1000 only when the effective profile is startup "
                "and the budget is NORMAL. Otherwise the request stays on universe_size."
            ),
        ),
    ] = False,
) -> dict[str, object]:
    """Statistical outlier scan."""
    params = _build_input(
        DetectAnomaliesInput,
        "detect_market_anomalies",
        quote_currency=quote_currency,
        universe_size=universe_size,
        deep_scan=deep_scan,
    )
    return await _tracked(
        "detect_market_anomalies",
        workflows.detect_market_anomalies(params, deps=_deps),
    )


@mcp.tool(
    description=(
        "Pakai tool ini untuk membandingkan 2 sampai 8 aset. "
        "Jangan pakai untuk satu aset saja. Butuh input symbols."
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
        "Pakai tool ini untuk profil satu aset dan CMC ID kanonik. "
        "Jangan pakai untuk perbandingan banyak aset. Butuh input symbol."
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
        "Pakai tool ini untuk momentum multi-horizon pada ticker yang disebut. "
        "Jangan pakai untuk menyaring seluruh pasar. Butuh input symbols."
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
        "Pakai tool ini untuk rotasi dan breadth sektor. "
        "Jangan pakai untuk profil satu koin. Butuh input sectors opsional."
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
        "Pakai tool ini untuk volatilitas, drawdown, dan beta historis. "
        "Jangan pakai bila yang diminta hanya harga terkini. Butuh input symbol."
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
        "Pakai tool ini untuk open interest dan funding derivatif, atau proxy spot yang jujur. "
        "Jangan pakai untuk market cap spot saja. Butuh input symbol."
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
                        api_key_id=record.persisted_key_id,
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
                api_key_id=record.persisted_key_id if record is not None else None,
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


def _sanitize_prompt_ticker_list(raw: str, field_name: str, *, multiple: bool) -> str:
    import re

    ticker_re = re.compile(r"^[A-Za-z0-9]{1,20}$")
    parts = [piece.strip().upper() for piece in raw.split(",") if piece.strip()]
    if not parts or (not multiple and len(parts) != 1):
        raise ValueError(f"Invalid prompt argument '{field_name}': expected ticker symbol(s).")
    if not all(ticker_re.fullmatch(part) for part in parts):
        raise ValueError(
            f"Invalid prompt argument '{field_name}': symbols must be 1-20 alphanumeric chars."
        )
    return ", ".join(parts)


@mcp.prompt(name="daily-market-briefing")
def daily_market_briefing() -> str:
    """Morning market briefing workflow."""
    return (
        "Workflow briefing pasar pagi: 1) get_capabilities. 2) get_market_overview. "
        "3) analyze_market_regime. 4) analyze_sector_rotation. "
        "Sebut setiap evidence_id. Jika sebuah tool berstatus fallback, tulis itu dan "
        "jangan mengisi angka yang hilang dengan 0. Do not give investment advice, "
        "recommendations, or price targets."
    )


@mcp.prompt(name="asset-due-diligence")
def asset_due_diligence(
    symbol: Annotated[str, Field(description="Primary ticker symbol string, e.g. 'BTC'.")],
    peers: Annotated[
        str,
        Field(description="Comma-separated string of peer ticker symbols, e.g. 'ETH, SOL'."),
    ],
) -> str:
    """Single-asset due diligence workflow."""
    clean_symbol = _sanitize_prompt_ticker_list(symbol, "symbol", multiple=False)
    clean_peers = _sanitize_prompt_ticker_list(peers, "peers", multiple=True)
    return (
        f"Workflow due diligence {clean_symbol}: 1) get_capabilities. "
        f"2) analyze_asset untuk {clean_symbol}. "
        f"3) compare_assets untuk {clean_symbol} dan {clean_peers}. "
        f"4) get_historical_performance untuk {clean_symbol}. "
        "Sebut evidence_id dan batasan data. Do not give investment advice, "
        "recommendations, or price targets."
    )


@mcp.prompt(name="market-risk-review")
def market_risk_review(
    symbols: Annotated[
        str,
        Field(description="Comma-separated string of ticker symbols, e.g. 'BTC, ETH, SOL'."),
    ],
) -> str:
    """Weekly sector rotation workflow. The prompt name stays stable for existing clients."""
    clean_symbols = _sanitize_prompt_ticker_list(symbols, "symbols", multiple=True)
    return (
        "Workflow rotasi sektor mingguan: 1) get_capabilities. 2) analyze_sector_rotation. "
        "3) scan_market_movers. 4) detect_market_anomalies. "
        f"Jika pengguna menyebut aset, tambahkan analyze_derivatives untuk {clean_symbols}. "
        "Sebut evidence_id. Do not give investment advice, recommendations, or price targets."
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
        return {
            key: _jsonable(value)
            for key, value in row.items()
            if key not in {"api_key", "user_id", "api_key_id"}
        }

    return await asyncio.to_thread(read)


def _jsonable(value: object) -> object:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "isoformat") and callable(value.isoformat):
        return value.isoformat()
    return str(value)
