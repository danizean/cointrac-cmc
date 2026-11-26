import asyncio
import hashlib
import hmac
import inspect
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

import pandas as pd

from app.adapters.cache import freshness_for_age
from app.adapters.cmc_client import CMCClient, CMCEndpointUnavailableError, FetchMeta
from app.adapters.normalizer import (
    SymbolResolution,
    as_float,
    choose_ids,
    fear_greed,
    fear_greed_historical_trends,
    global_historical_trends,
    global_quote,
    keyed_assets,
    listing_rows,
    map_rows,
    ohlcv_points,
    parse_derivatives_exchanges,
    parse_derivatives_pairs,
    parse_market_wide_liquidations,
    parse_rwa_universe,
    performance_rows,
    quote_of,
)
from app.core.config import get_settings
from app.quant.anomalies import (
    MIN_ANOMALY_SAMPLE,
    btc_divergence,
    classify_volume_anomaly_direction,
    log_volume_to_mcap,
    modified_zscores,
    standard_zscores,
)
from app.quant.metrics import (
    annualized_volatility,
    beta,
    circulating_supply_pct,
    composite_momentum_score,
    fdv_to_mcap_ratio,
    log_returns,
    maximum_drawdown,
    pearson_correlation,
    relative_strength,
    simple_returns,
    utc_daily_close,
    volume_to_mcap,
)
from app.quant.regime import classify_regime
from app.quant.screening import (
    UniverseAsset,
    classify_stablecoin,
    screen_movers,
)
from app.quant.sectors import (
    MAX_BENCHMARK_TIMESTAMP_SKEW_SECONDS,
    MIN_SECTOR_CONSTITUENTS,
    Constituent,
    aggregate_sector,
    classify_rotation_signal,
    excess_return,
    market_median_benchmark,
    timestamps_aligned,
)
from app.schemas.envelope import (
    AgentAction,
    EvidenceEnvelope,
    EvidenceMeta,
    EvidenceStatus,
    MethodologyMeta,
)
from app.schemas.tools import (
    AnalyzeAssetData,
    AnalyzeAssetInput,
    AnalyzeMomentumData,
    AnalyzeMomentumInput,
    AnomalyHit,
    AssetComparison,
    BtcDivergence,
    CapabilitiesData,
    CompareAssetsData,
    CompareAssetsInput,
    DerivativePairObservation,
    DerivativesAnalysisData,
    DerivativesAnalysisInput,
    DerivativesVenuesContext,
    DerivativeVenueBrief,
    DetectAnomaliesData,
    DetectAnomaliesInput,
    HistoricalPerformanceData,
    HistoricalPerformanceInput,
    MarketOverviewData,
    MarketRegimeData,
    MarketWideLiquidationsContext,
    MomentumRow,
    MoverRow,
    PricePerformance,
    QuoteBrief,
    RwaAssetBrief,
    RwaUniverseContext,
    ScanMoversData,
    ScanMoversInput,
    SectorRotationData,
    SectorRotationInput,
    SectorSnapshot,
    ToolAvailability,
)
from app.services.daily_closes import (
    DAILY_CLOSE_SOURCE,
    MIN_WAREHOUSE_DAYS,
    DailyCloseRow,
    DailyCloseStore,
    SupabaseDailyCloseStore,
)
from app.services.evidence import (
    CallRecord,
    EvidenceDraft,
    EvidenceWriter,
    SupabaseEvidenceWriter,
    dedupe_limitations,
    new_evidence_id,
    raw_excerpt,
    summarize_calls,
)

GLOBAL = "/v1/global-metrics/quotes/latest"
GLOBAL_HISTORICAL = "/v1/global-metrics/quotes/historical"
FEAR = "/v3/fear-and-greed/latest"
FEAR_HISTORICAL = "/v3/fear-and-greed/historical"
HISTORICAL_TREND_TTL_SECONDS = 86400
LISTINGS = "/v1/cryptocurrency/listings/latest"
QUOTES = "/v2/cryptocurrency/quotes/latest"
INFO = "/v2/cryptocurrency/info"
OHLCV = "/v2/cryptocurrency/ohlcv/historical"
PERFORMANCE = "/v2/cryptocurrency/price-performance-stats/latest"
MAP = "/v1/cryptocurrency/map"
CATEGORIES = "/v1/cryptocurrency/categories"
CATEGORY = "/v1/cryptocurrency/category"
DERIVATIVES = "/v5/cryptocurrency/derivatives/market-pairs/list/latest"
LIQUIDATIONS = "/v5/derivatives/liquidations/quotes/latest"
DERIVATIVES_EXCHANGES = "/v5/exchange/derivatives/list"
RWA_MAP = "/v5/real-world-assets/map"
RWA_ASSETS_LIST = "/v5/real-world-assets/assets/list"
OUTLIER_Z = 3.0
OUTLIER_MODIFIED_Z = 3.5
SHARED_LISTINGS_LIMIT = 200
DERIVATIVES_PAIR_LIMIT = 25
BYOK_CAPABILITY_TTL_SECONDS = 900.0
CapabilityState = Literal["ALLOWED", "DENIED", "UNKNOWN"]


@dataclass(frozen=True)
class SectorDef:
    slug: str
    display_name: str
    category_id: str | None
    fallback_tags: tuple[str, ...]


DEFAULT_SECTORS = (
    SectorDef("defi", "DeFi", None, ("defi", "decentralized-finance")),
    SectorDef("ai-big-data", "AI & Big Data", None, ("ai-big-data", "artificial-intelligence")),
    SectorDef("layer-1", "Layer 1", None, ("layer-1",)),
    SectorDef("layer-2", "Layer 2", None, ("layer-2", "scaling")),
    SectorDef("gaming", "Gaming", None, ("gaming", "gamefi")),
    SectorDef("rwa", "Real World Assets", None, ("real-world-assets", "tokenized-assets")),
    SectorDef("memes", "Memes", None, ("memes", "meme")),
)


class AssetBook:
    async def resolve(self, symbols: list[str]) -> SymbolResolution:
        from app.adapters.normalizer import resolve_symbols_to_ids

        try:
            return await resolve_symbols_to_ids(symbols)
        except RuntimeError:
            return SymbolResolution({}, ["market_assets is not configured"])


_CANONICAL_CATEGORY_NAMES: dict[str, tuple[str, ...]] = {
    "defi": ("defi", "decentralized finance"),
    "ai-big-data": ("ai & big data", "ai and big data"),
    "layer-1": ("layer 1", "layer-1"),
    "layer-2": ("layer 2", "layer-2"),
    "gaming": ("gaming",),
    "rwa": ("real world assets", "real-world assets"),
    "memes": ("memes", "memecoins"),
}


def match_cmc_categories(
    sectors: list[SectorDef],
    categories_payload: dict[str, object] | None,
) -> list[SectorDef]:
    """Attach canonical CMC category IDs by exact normalized name when missing."""
    if not isinstance(categories_payload, dict):
        return sectors
    rows = categories_payload.get("data")
    if not isinstance(rows, list):
        return sectors
    by_name: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        cat_id = row.get("id")
        name = row.get("name")
        if isinstance(cat_id, str) and cat_id.strip() and isinstance(name, str) and name.strip():
            by_name[name.strip().lower()] = cat_id.strip()
    if not by_name:
        return sectors
    enriched: list[SectorDef] = []
    for sector in sectors:
        if sector.category_id is not None:
            enriched.append(sector)
            continue
        candidates = _CANONICAL_CATEGORY_NAMES.get(sector.slug, (sector.display_name.lower(),))
        matched_id = next((by_name[name] for name in candidates if name in by_name), None)
        enriched.append(
            SectorDef(sector.slug, sector.display_name, matched_id, sector.fallback_tags)
        )
    return enriched


class SectorBook:
    def __init__(
        self,
        *,
        client: object | None = None,
        use_db: bool = False,
        enrich_from_snapshots: bool = False,
    ) -> None:
        self._client = client
        self._use_db = use_db or client is not None
        self._enrich_from_snapshots = enrich_from_snapshots

    async def load(self) -> list[SectorDef]:
        if not self._use_db:
            return list(DEFAULT_SECTORS)
        try:
            db = self._client
            if db is None:
                from app.core.db import supabase_client

                db = supabase_client()

            def read() -> tuple[list[dict[str, object]], dict[str, object] | None]:
                table = db.table("sector_mappings")  # type: ignore[attr-defined]
                response = table.select(
                    "sector_slug,display_name,cmc_category_id,fallback_tags"
                ).execute()
                mapping_rows = [row for row in (response.data or []) if isinstance(row, dict)]
                cat_payload: dict[str, object] | None = None
                if self._enrich_from_snapshots:
                    snap_resp = (
                        db.table("cmc_snapshots")  # type: ignore[attr-defined]
                        .select("payload")
                        .eq("endpoint", CATEGORIES)
                        .order("retrieved_at", desc=True)
                        .limit(1)
                        .execute()
                    )
                    snaps = snap_resp.data or []
                    if snaps and isinstance(snaps[0], dict):
                        raw = snaps[0].get("payload")
                        if isinstance(raw, dict):
                            cat_payload = raw
                return mapping_rows, cat_payload

            rows, cat_payload = await asyncio.to_thread(read)
        except Exception:
            return list(DEFAULT_SECTORS)

        default_order = {item.slug: idx for idx, item in enumerate(DEFAULT_SECTORS)}
        loaded: list[SectorDef] = []
        for row in rows:
            slug = str(row.get("sector_slug") or "").strip().lower()
            if slug not in default_order:
                continue
            display_name = str(row.get("display_name") or slug).strip()
            raw_cat = row.get("cmc_category_id")
            category_id = (
                str(raw_cat).strip() if isinstance(raw_cat, str) and raw_cat.strip() else None
            )
            raw_tags = row.get("fallback_tags")
            tags = (
                tuple(str(tag).strip().lower() for tag in raw_tags if str(tag).strip())
                if isinstance(raw_tags, list)
                else ()
            )
            if not tags:
                tags = next((d.fallback_tags for d in DEFAULT_SECTORS if d.slug == slug), ())
            loaded.append(SectorDef(slug, display_name, category_id, tags))
        if not loaded:
            loaded = list(DEFAULT_SECTORS)
        else:
            loaded.sort(key=lambda item: default_order.get(item.slug, 999))
        return match_cmc_categories(loaded, cat_payload)


class CapabilityMap:
    def __init__(self, *, byok_ttl_seconds: float = BYOK_CAPABILITY_TTL_SECONDS) -> None:
        self._salt = secrets.token_bytes(32)
        self._byok_ttl = byok_ttl_seconds
        self._byok_states: dict[str, dict[str, tuple[float, CapabilityState]]] = {}

    def _ensure_state(self) -> None:
        if not hasattr(self, "_salt"):
            self._salt = secrets.token_bytes(32)
        if not hasattr(self, "_byok_ttl"):
            self._byok_ttl = BYOK_CAPABILITY_TTL_SECONDS
        if not hasattr(self, "_byok_states"):
            self._byok_states: dict[str, dict[str, tuple[float, CapabilityState]]] = {}

    def _fingerprint(self, credential: str) -> str:
        self._ensure_state()
        return hmac.new(
            self._salt,
            credential.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:24]

    def _prune_byok(self, now: float) -> None:
        self._ensure_state()
        if len(self._byok_states) <= 256:
            return
        stale_fps = []
        for fp, entries in self._byok_states.items():
            expired = [ep for ep, (exp, _) in entries.items() if exp <= now]
            for ep in expired:
                entries.pop(ep, None)
            if not entries:
                stale_fps.append(fp)
        for fp in stale_fps:
            self._byok_states.pop(fp, None)

    def state(self, endpoint: str, credential: str | None = None) -> CapabilityState:
        self._ensure_state()
        if credential is not None:
            now = time.monotonic()
            fp = self._fingerprint(credential)
            entries = self._byok_states.get(fp)
            if not entries:
                return "UNKNOWN"
            cached = entries.get(endpoint)
            if cached is None or cached[0] <= now:
                if cached is not None:
                    entries.pop(endpoint, None)
                return "UNKNOWN"
            return cached[1]
        return "ALLOWED" if self._server_allows(endpoint) else "DENIED"

    def record_outcome(
        self,
        endpoint: str,
        *,
        allowed: bool,
        credential: str | None = None,
    ) -> None:
        if credential is None:
            return
        self._ensure_state()
        now = time.monotonic()
        self._prune_byok(now)
        fp = self._fingerprint(credential)
        entries = self._byok_states.setdefault(fp, {})
        entries[endpoint] = (now + self._byok_ttl, "ALLOWED" if allowed else "DENIED")

    def allows(self, endpoint: str, credential: str | None = None) -> bool:
        if credential is not None:
            # Per-key state: DENIED blocks repeat calls for this key; UNKNOWN allows 1 probe.
            return self.state(endpoint, credential) != "DENIED"
        return self._server_allows(endpoint)

    def _matrix_entry(self, endpoint: str) -> tuple[str | None, dict[str, object] | None]:
        from app.core.config import get_settings

        path = get_settings().capability_matrix_path
        if not path.is_file():
            return None, None
        import json

        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return None, None
        generated = payload.get("generated_at_utc")
        generated_str = str(generated) if isinstance(generated, str) and generated else None
        results = payload.get("results")
        if not isinstance(results, list):
            return generated_str, None
        for row in results:
            if isinstance(row, dict) and row.get("endpoint") == endpoint:
                return generated_str, row
        return generated_str, None

    def _server_allows(self, endpoint: str) -> bool:
        _, row = self._matrix_entry(endpoint)
        if row is None:
            return True
        return row.get("status") not in {"TIER_RESTRICTED", "NOT_FOUND"}

    def block_reason(self, endpoint: str, credential: str | None = None) -> str:
        if credential is not None:
            return (
                f"{endpoint} is unavailable without a live request: previously denied "
                "(HTTP 403 / CMC 1006) for this API key."
            )
        generated, row = self._matrix_entry(endpoint)
        if row is not None:
            status = row.get("status") or "TIER_RESTRICTED"
            http_status = row.get("http_status")
            cmc_code = row.get("cmc_error_code")
            details = []
            if http_status is not None:
                details.append(f"HTTP {http_status}")
            if cmc_code is not None:
                details.append(f"CMC {cmc_code}")
            code_part = f" ({', '.join(details)})" if details else ""
            probe_part = f" in capability matrix probe {generated}" if generated else ""
            return (
                f"{endpoint} is unavailable without a live request: "
                f"marked {status}{code_part}{probe_part}."
            )
        return f"{endpoint} is unavailable without a live request: blocked by capability metadata."


def _capability_allows(deps: "ServiceDeps", endpoint: str, credential: str | None) -> bool:
    method = deps.capabilities.allows
    params = inspect.signature(method).parameters
    if len(params) >= 2:
        return method(endpoint, credential)
    return method(endpoint)


def _capability_block_reason(deps: "ServiceDeps", endpoint: str, credential: str | None) -> str:
    method = getattr(deps.capabilities, "block_reason", None)
    if callable(method):
        return str(method(endpoint, credential))
    return f"{endpoint} is unavailable without a live request: blocked by capability metadata."


@dataclass
class ServiceDeps:
    gateway: object
    evidence: EvidenceWriter
    assets: AssetBook
    sectors: SectorBook
    capabilities: CapabilityMap
    now: Callable[[], datetime]
    daily_closes: DailyCloseStore | None = None

    @classmethod
    def create(cls) -> "ServiceDeps":
        return cls(
            gateway=CMCClient(),
            evidence=SupabaseEvidenceWriter(),
            assets=AssetBook(),
            sectors=SectorBook(use_db=True, enrich_from_snapshots=True),
            capabilities=CapabilityMap(),
            now=lambda: datetime.now(UTC),
            daily_closes=SupabaseDailyCloseStore(),
        )


_installed: ServiceDeps | None = None
_default_deps: ServiceDeps | None = None


def install_deps(deps: ServiceDeps | None) -> None:
    global _installed
    _installed = deps


def set_default_deps(deps: ServiceDeps | None) -> None:
    global _default_deps
    _default_deps = deps


def _bound(deps: ServiceDeps | None) -> ServiceDeps:
    global _default_deps
    if deps is not None:
        return deps
    if _installed is not None:
        return _installed
    if _default_deps is None:
        _default_deps = ServiceDeps.create()
    return _default_deps


class Collector:
    def __init__(
        self,
        gateway: object,
        override: str | None,
        capabilities: CapabilityMap | None = None,
    ) -> None:
        self.gateway = gateway
        self.override = override
        self.capabilities = capabilities
        self.records: list[CallRecord] = []

    async def get(self, endpoint: str, params: dict[str, object]) -> dict[str, object] | None:
        payload, _ = await self.get_with_record(endpoint, params)
        return payload

    async def get_with_record(
        self,
        endpoint: str,
        params: dict[str, object],
    ) -> tuple[dict[str, object] | None, CallRecord]:
        try:
            payload, meta = await self.gateway.fetch(  # type: ignore[attr-defined]
                endpoint,
                params,
                None,
                self.override,
            )
        except CMCEndpointUnavailableError as exc:
            # Only true plan/endpoint access denial (403/1006) caches DENIED capability.
            # Auth failures (401), rate limits (429), and transient 5xx/network errors
            # must NEVER pollute per-key capability state.
            if (
                exc.category == "tier_restricted"
                and self.override is not None
                and self.capabilities is not None
            ):
                recorder = getattr(self.capabilities, "record_outcome", None)
                if callable(recorder):
                    recorder(endpoint, allowed=False, credential=self.override)
            record = CallRecord(endpoint, error=str(exc), error_category=exc.category)
            self.records.append(record)
            return None, record
        if not isinstance(payload, dict) or not isinstance(meta, FetchMeta):
            message = f"{endpoint} returned an unexpected payload"
            record = CallRecord(endpoint, error=message)
            self.records.append(record)
            return None, record
        if self.override is not None and self.capabilities is not None:
            recorder = getattr(self.capabilities, "record_outcome", None)
            if callable(recorder):
                recorder(endpoint, allowed=True, credential=self.override)
        record = CallRecord(endpoint, payload, meta)
        self.records.append(record)
        return payload, record

    async def get_optional(
        self,
        endpoint: str,
        params: dict[str, object],
        *,
        ttl_seconds: int | None = None,
        context_label: str = "optional context",
    ) -> tuple[dict[str, object] | None, str | None]:
        """Fetch optional enrichment endpoint without failing primary workflow status."""
        handlers = getattr(self.gateway, "handlers", None)
        if isinstance(handlers, dict) and endpoint not in handlers:
            return None, f"{endpoint} {context_label} was unavailable; optional fields left null."
        try:
            payload, meta = await self.gateway.fetch(  # type: ignore[attr-defined]
                endpoint,
                params,
                ttl_seconds,
                self.override,
            )
        except KeyError:
            if isinstance(self.gateway, CMCClient):
                raise
            return None, f"{endpoint} {context_label} was unavailable; optional fields left null."
        except CMCEndpointUnavailableError as exc:
            if (
                exc.category == "tier_restricted"
                and self.override is not None
                and self.capabilities is not None
            ):
                recorder = getattr(self.capabilities, "record_outcome", None)
                if callable(recorder):
                    recorder(endpoint, allowed=False, credential=self.override)
            return None, (
                f"{endpoint} {context_label} unavailable ({exc.reason}); optional fields left null."
            )
        if not isinstance(payload, dict) or not isinstance(meta, FetchMeta):
            return None, f"{endpoint} returned an unexpected {context_label} payload."
        if self.override is not None and self.capabilities is not None:
            recorder = getattr(self.capabilities, "record_outcome", None)
            if callable(recorder):
                recorder(endpoint, allowed=True, credential=self.override)
        self.records.append(CallRecord(endpoint, payload, meta))
        return payload, None


async def _fetch_historical_context(
    collector: Collector,
    bound: ServiceDeps,
    quote_currency: str,
) -> tuple[dict[str, float | None], dict[str, float | None], list[str]]:
    """Fetch 24h-cached 7d-30d macro & sentiment context via the existing CMCClient."""
    notes: list[str] = []

    async def _get_global_hist() -> dict[str, object] | None:
        if not _capability_allows(bound, GLOBAL_HISTORICAL, collector.override):
            notes.append(
                f"{GLOBAL_HISTORICAL} is outside the current CoinMarketCap plan; "
                "7d/30d market cap and BTC dominance trends left null."
            )
            return None
        payload, err = await collector.get_optional(
            GLOBAL_HISTORICAL,
            {"count": 30, "interval": "daily", "convert": quote_currency},
            ttl_seconds=HISTORICAL_TREND_TTL_SECONDS,
            context_label="historical trend context",
        )
        if err:
            notes.append(err)
        return payload

    async def _get_fear_hist() -> dict[str, object] | None:
        if not _capability_allows(bound, FEAR_HISTORICAL, collector.override):
            notes.append(
                f"{FEAR_HISTORICAL} is outside the current CoinMarketCap plan; "
                "7d/30d Fear & Greed trends left null."
            )
            return None
        payload, err = await collector.get_optional(
            FEAR_HISTORICAL,
            {"limit": 30},
            ttl_seconds=HISTORICAL_TREND_TTL_SECONDS,
            context_label="historical trend context",
        )
        if err:
            notes.append(err)
        return payload

    global_hist_payload, fear_hist_payload = await asyncio.gather(
        _get_global_hist(),
        _get_fear_hist(),
    )
    global_trends = global_historical_trends(global_hist_payload or {}, quote_currency)
    fear_trends = fear_greed_historical_trends(fear_hist_payload or {})
    if global_hist_payload is not None and all(v is None for v in global_trends.values()):
        notes.append(
            f"{GLOBAL_HISTORICAL} returned insufficient daily observations for 7d/30d trends."
        )
    if fear_hist_payload is not None and all(v is None for v in fear_trends.values()):
        notes.append(
            f"{FEAR_HISTORICAL} returned insufficient daily observations for 7d/30d trends."
        )
    return global_trends, fear_trends, notes


async def _listings_universe(
    collector: Collector,
    quote_currency: str,
    limit: int,
    *,
    page: bool = False,
) -> list[dict[str, object]]:
    """Fetch listings. Deep Scan pages by 200 rows up to the requested limit."""
    if not page or limit <= SHARED_LISTINGS_LIMIT:
        fetch_limit = SHARED_LISTINGS_LIMIT if limit <= SHARED_LISTINGS_LIMIT else limit
        payload = await collector.get(
            LISTINGS,
            {"start": 1, "limit": fetch_limit, "convert": quote_currency},
        )
        return listing_rows(payload or {})[:limit]
    rows: list[dict[str, object]] = []
    start = 1
    while len(rows) < limit:
        page_limit = min(SHARED_LISTINGS_LIMIT, limit - len(rows))
        payload = await collector.get(
            LISTINGS,
            {"start": start, "limit": page_limit, "convert": quote_currency},
        )
        batch = listing_rows(payload or {})
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_limit:
            break
        start += page_limit
    return rows[:limit]


async def _deep_scan_limit(
    requested: bool,
    universe_size: int,
    override_cmc_key: str | None,
    notes: list[str],
) -> tuple[int, bool]:
    if not requested:
        return universe_size, False
    if override_cmc_key:
        notes.append(
            "Deep Scan was requested and downgraded because a caller-supplied key "
            "does not use the server quota."
        )
        return universe_size, False
    from app.services.budget import get_budget_controller
    from app.services.tier_detection import get_tier_detector

    snap = await get_budget_controller().snapshot()
    if get_tier_detector().startup_features_open(
        state=snap.state,
        warning_level=snap.warning_level,
        ledger_status=snap.ledger_status,
    ):
        notes.append(
            "Deep Scan paged listings up to 1000 because the effective profile is startup "
            "and the budget state is NORMAL."
        )
        return 1000, True
    notes.append(
        "Deep Scan was requested and downgraded to the normal universe. "
        f"Effective profile is {get_tier_detector().effective_profile()} "
        f"and budget state is {snap.state}."
    )
    return universe_size, False


async def get_market_overview(
    quote_currency: str = "USD",
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[MarketOverviewData]:
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    global_payload, fear_payload, rows, hist_context = await asyncio.gather(
        collector.get(GLOBAL, {"convert": quote_currency}),
        collector.get(FEAR, {}),
        _listings_universe(collector, quote_currency, 50),
        _fetch_historical_context(collector, bound, quote_currency),
    )
    global_trends, fear_trends, trend_notes = hist_context
    metrics = global_quote(global_payload or {}, quote_currency)
    fg_value, fg_label = fear_greed(fear_payload or {})
    briefs = [_brief(row, quote_currency) for row in rows]
    directional_briefs: list[QuoteBrief] = []
    overview_excluded_stables = 0
    for raw_row, brief in zip(rows, briefs, strict=True):
        if classify_stablecoin(_raw_tags(raw_row)) == "verified_stablecoin":
            overview_excluded_stables += 1
            continue
        if brief.percent_change_24h is not None:
            directional_briefs.append(brief)
    overview_notes: list[str] = list(trend_notes)
    if overview_excluded_stables > 0:
        overview_notes.append(
            f"{overview_excluded_stables} verified stablecoin(s) excluded from directional "
            "top_gainers/top_losers rankings while preserved in aggregate market overview metrics."
        )
    positive_briefs = [
        row for row in directional_briefs if (row.percent_change_24h or 0.0) > 0.0
    ]
    negative_briefs = [
        row for row in directional_briefs if (row.percent_change_24h or 0.0) < 0.0
    ]
    if not negative_briefs:
        overview_notes.append(
            "No non-stablecoin assets in the top 50 posted negative 24h returns; "
            "top_losers is empty rather than including positive performers."
        )
    elif len(negative_briefs) < 5:
        overview_notes.append(
            f"Only {len(negative_briefs)} non-stablecoin asset(s) in the top 50 posted "
            "negative 24h returns; top_losers excludes positive performers."
        )
    data = MarketOverviewData(
        quote_currency=quote_currency,
        total_market_cap=metrics.get("total_market_cap"),
        total_volume_24h=metrics.get("total_volume_24h"),
        total_market_cap_change_24h_pct=metrics.get("total_market_cap_change_24h_pct"),
        btc_dominance=metrics.get("btc_dominance"),
        eth_dominance=metrics.get("eth_dominance"),
        btc_dominance_change_24h=metrics.get("btc_dominance_change_24h"),
        fear_greed_value=fg_value,
        fear_greed_classification=fg_label,
        top50_breadth_positive_pct=_breadth([row.percent_change_24h for row in briefs]),
        total_market_cap_change_7d_pct=global_trends.get("total_market_cap_change_7d_pct"),
        total_market_cap_change_30d_pct=global_trends.get("total_market_cap_change_30d_pct"),
        btc_dominance_change_7d=global_trends.get("btc_dominance_change_7d"),
        btc_dominance_change_30d=global_trends.get("btc_dominance_change_30d"),
        fear_greed_avg_7d=fear_trends.get("fear_greed_avg_7d"),
        fear_greed_avg_30d=fear_trends.get("fear_greed_avg_30d"),
        fear_greed_change_7d=fear_trends.get("fear_greed_change_7d"),
        fear_greed_change_30d=fear_trends.get("fear_greed_change_30d"),
        btc=_find(briefs, "BTC"),
        eth=_find(briefs, "ETH"),
        sol=_find(briefs, "SOL"),
        top_gainers=sorted(
            positive_briefs, key=lambda row: row.percent_change_24h or 0.0, reverse=True
        )[:5],
        top_losers=sorted(negative_briefs, key=lambda row: row.percent_change_24h or 0.0)[:5],
    )
    return await _envelope(
        "get_market_overview",
        _status(collector, data.total_market_cap is not None),
        f"Market overview in {quote_currency}.",
        data,
        ["total_market_cap", "fear_greed", "top50_breadth", "historical_trends_7d_30d"],
        "latest; 7d-30d daily historical context (24h cached)",
        [],
        collector,
        bound,
        overview_notes,
    )


async def scan_market_movers(
    params: ScanMoversInput,
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[ScanMoversData]:
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    scan_notes: list[str] = []
    scan_limit, page = await _deep_scan_limit(
        params.deep_scan,
        params.universe_size,
        override_cmc_key,
        scan_notes,
    )
    rows = await _listings_universe(collector, params.quote_currency, scan_limit, page=page)
    btc = _find_raw(rows, "BTC")
    btc_7d = None
    if btc is not None:
        btc_7d = as_float(quote_of(btc, params.quote_currency).get("percent_change_7d"))
    if btc_7d is None:
        collector.records.append(CallRecord(LISTINGS, error="BTC 7d change was missing"))
    eligible_universe: list[UniverseAsset] = []
    excluded_stables = 0
    unknown_class_count = 0
    corrupt_excluded = 0
    for row in rows:
        if row.get("symbol") == "BTC":
            continue
        stable_cls = classify_stablecoin(_raw_tags(row))
        if stable_cls == "verified_stablecoin":
            excluded_stables += 1
            continue
        if _is_corrupt_listing_quote(row, params.quote_currency):
            corrupt_excluded += 1
            continue
        if stable_cls == "unknown":
            unknown_class_count += 1
        eligible_universe.append(_universe(row, params.quote_currency))
    screened = screen_movers(
        eligible_universe,
        btc_percent_change_7d=btc_7d,
        min_market_cap_usd=params.min_market_cap_usd,
        min_volume_24h_usd=params.min_volume_24h_usd,
        min_vol_to_mcap=params.min_vol_to_mcap,
        min_rs_vs_btc_7d=params.min_rs_vs_btc_7d,
        max_24h_gain_pct=params.max_24h_gain_pct,
        max_7d_gain_pct=params.max_7d_gain_pct,
        rank_by=params.rank_by,
        limit=params.limit,
    )
    data = ScanMoversData(
        quote_currency=params.quote_currency,
        rank_by=params.rank_by,
        movers=[
            MoverRow(
                cmc_id=row.cmc_id,
                symbol=row.symbol,
                name=row.name,
                market_cap=row.market_cap,
                volume_24h=row.volume_24h,
                volume_to_mcap=row.volume_to_mcap,
                percent_change_24h=row.percent_change_24h,
                percent_change_7d=row.percent_change_7d,
                percent_change_30d=row.percent_change_30d,
                percent_change_60d=row.percent_change_60d,
                rs_vs_btc_7d=row.rs_vs_btc_7d,
                composite_momentum_score=row.composite_momentum_score,
                timeframes_available=row.timeframes_available,
                multi_horizon_risk=row.multi_horizon_risk,
            )
            for row in screened
        ],
    )
    notes: list[str] = []
    notes.extend(scan_notes)
    if excluded_stables > 0:
        notes.append(
            f"{excluded_stables} verified stablecoin(s) excluded from directional mover "
            "rankings using CoinMarketCap canonical stablecoin tags."
        )
    if unknown_class_count > 0:
        notes.append(
            f"{unknown_class_count} asset(s) had missing/empty classification tags "
            "(unknown stablecoin status) and were preserved rather than silently discarded."
        )
    if corrupt_excluded > 0:
        notes.append(
            f"{corrupt_excluded} zero-volume or extreme-outlier listing(s) excluded from "
            "mover rankings to prevent upstream data corruption."
        )
    if any(
        row.timeframes_available is not None and row.timeframes_available < 4 for row in data.movers
    ):
        notes.append(
            "One or more movers had fewer than 4 momentum timeframes (24h/7d/30d/60d); "
            "composite_momentum_score re-normalized available timeframes."
        )
    risk_warnings: list[str] = []
    missing_horizon_syms: list[str] = []
    for mover in data.movers:
        risk = mover.multi_horizon_risk
        if risk in {"EXTENDED_RALLY", "SHARP_RETRACEMENT", "POTENTIAL_EXHAUSTION"}:
            c24 = (
                f"{mover.percent_change_24h:+.1f}%"
                if mover.percent_change_24h is not None
                else "n/a"
            )
            c7 = (
                f"{mover.percent_change_7d:+.1f}%" if mover.percent_change_7d is not None else "n/a"
            )
            c30 = (
                f"{mover.percent_change_30d:+.1f}%"
                if mover.percent_change_30d is not None
                else "n/a"
            )
            risk_warnings.append(f"{mover.symbol}={risk} (24h {c24}, 7d {c7}, 30d {c30})")
        elif risk == "INSUFFICIENT_HISTORY":
            missing_horizon_syms.append(mover.symbol)
    if risk_warnings:
        notes.append(
            "Multi-horizon anti-chase risk warning (descriptive return profile only, "
            "not a confirmed reversal): " + "; ".join(risk_warnings) + "."
        )
    if missing_horizon_syms:
        notes.append(
            "Multi-horizon anti-chase history incomplete (missing 7d or 30d returns, "
            "not zero-filled) for: " + ", ".join(missing_horizon_syms) + "."
        )
    if not data.movers:
        status = EvidenceStatus.INSUFFICIENT_DATA
    elif any(record.error for record in collector.records):
        status = EvidenceStatus.PARTIAL
    else:
        status = EvidenceStatus.OK
    return await _envelope(
        "scan_market_movers",
        status,
        f"{len(data.movers)} movers ranked by {params.rank_by}.",
        data,
        ["composite_momentum_score", "rs_vs_btc_7d", "volume_to_mcap"],
        f"top {params.universe_size} listings",
        [row.cmc_id for row in data.movers if row.cmc_id is not None],
        collector,
        bound,
        notes,
    )


async def compare_assets(
    params: CompareAssetsInput,
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[CompareAssetsData]:
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    ids, notes = await _resolve(bound, collector, [*params.symbols, "BTC"])
    assets = await _quoted(collector, ids, params.quote_currency)
    btc_quote = quote_of(assets.get("BTC") or {}, params.quote_currency)
    comparisons: list[AssetComparison] = []
    for symbol in params.symbols:
        asset = assets.get(symbol)
        if asset is None:
            notes.append(f"{symbol} had no quote")
            continue
        cmc_id = asset.get("id") if isinstance(asset.get("id"), int) else None
        closes = await _closes(collector, bound, cmc_id, params.quote_currency)
        series = utc_daily_close(closes)
        comparisons.append(_comparison(symbol, asset, params.quote_currency, series, btc_quote))
    if any(
        row.timeframes_available is not None and row.timeframes_available < 4 for row in comparisons
    ):
        notes.append(
            "One or more assets had fewer than 4 momentum timeframes (24h/7d/30d/60d); "
            "composite_momentum_score re-normalized available timeframes."
        )
    data = CompareAssetsData(quote_currency=params.quote_currency, assets=comparisons)
    if not comparisons:
        status = EvidenceStatus.INSUFFICIENT_DATA
    elif len(comparisons) < len(params.symbols) or any(
        record.error for record in collector.records
    ):
        status = EvidenceStatus.PARTIAL
    else:
        status = EvidenceStatus.OK
    return await _envelope(
        "compare_assets",
        status,
        (
            f"Compared {len(comparisons)} of {len(params.symbols)} requested assets."
            if len(comparisons) < len(params.symbols)
            else f"Compared {len(comparisons)} assets."
        ),
        data,
        [
            "volume_to_mcap",
            "fdv_to_mcap_ratio",
            "relative_strength",
            "composite_momentum_score",
            "annualized_volatility",
        ],
        "latest quotes; daily OHLCV when available",
        [row.cmc_id for row in comparisons if row.cmc_id is not None],
        collector,
        bound,
        notes,
    )


async def analyze_asset(
    params: AnalyzeAssetInput,
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[AnalyzeAssetData]:
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    ids, notes = await _resolve(bound, collector, [params.symbol, "BTC"])
    resolved_id = ids.get(params.symbol)
    assets = await _quoted(collector, ids, params.quote_currency) if ids else {}
    asset = assets.get(params.symbol)
    btc = assets.get("BTC")
    tags: list[str] = []
    periods: list[PricePerformance] = []
    closes: list[tuple[datetime, float]] = []
    performance_unavailable = False
    if resolved_id is None:
        notes.append(f"{params.symbol} could not be resolved to a canonical CoinMarketCap ID.")
    else:
        info = await collector.get(INFO, {"id": str(resolved_id)})
        tags = _tags(info or {}, resolved_id)
        if _capability_allows(bound, PERFORMANCE, collector.override):
            performance = await collector.get(PERFORMANCE, {"id": str(resolved_id)})
            period_rows = performance_rows(performance or {}, params.quote_currency)
            periods = [PricePerformance(**row) for row in period_rows]
            if performance is None:
                performance_unavailable = True
        else:
            performance_unavailable = True
            notes.append("Price performance stats are outside the current CoinMarketCap plan.")
        closes = await _closes(collector, bound, resolved_id, params.quote_currency)
    series = utc_daily_close(closes)
    quote = quote_of(asset or {}, params.quote_currency)
    btc_quote = quote_of(btc or {}, params.quote_currency)
    change_24h = as_float(quote.get("percent_change_24h"))
    change_7d = as_float(quote.get("percent_change_7d"))
    change_30d = as_float(quote.get("percent_change_30d"))
    change_60d = as_float(quote.get("percent_change_60d"))
    momentum_score, tf_count = composite_momentum_score(
        {
            "24h": change_24h,
            "7d": change_7d,
            "30d": change_30d,
            "60d": change_60d,
        }
    )
    if 0 < tf_count < 4:
        notes.append(
            f"{params.symbol} had {tf_count} of 4 momentum timeframes (24h/7d/30d/60d); "
            "composite_momentum_score re-normalized available timeframes."
        )
    data = AnalyzeAssetData(
        symbol=params.symbol,
        cmc_id=resolved_id,
        name=_text(asset, "name") if asset else None,
        quote_currency=params.quote_currency,
        price=as_float(quote.get("price")),
        market_cap=as_float(quote.get("market_cap")),
        volume_24h=as_float(quote.get("volume_24h")),
        volume_to_mcap=volume_to_mcap(
            as_float(quote.get("volume_24h")),
            as_float(quote.get("market_cap")),
        ),
        fdv_to_mcap_ratio=fdv_to_mcap_ratio(
            as_float(quote.get("fully_diluted_market_cap")),
            as_float(quote.get("market_cap")),
        ),
        circulating_supply=as_float((asset or {}).get("circulating_supply")),
        total_supply=as_float((asset or {}).get("total_supply")),
        max_supply=as_float((asset or {}).get("max_supply")),
        circulating_supply_pct=circulating_supply_pct(
            as_float((asset or {}).get("circulating_supply")),
            as_float((asset or {}).get("max_supply")),
        ),
        tags=tags,
        percent_change_24h=change_24h,
        percent_change_7d=change_7d,
        percent_change_30d=change_30d,
        percent_change_60d=change_60d,
        rs_vs_btc_24h=relative_strength(
            change_24h,
            as_float(btc_quote.get("percent_change_24h")),
        ),
        rs_vs_btc_7d=relative_strength(
            change_7d,
            as_float(btc_quote.get("percent_change_7d")),
        ),
        rs_vs_btc_30d=relative_strength(
            change_30d,
            as_float(btc_quote.get("percent_change_30d")),
        ),
        composite_momentum_score=momentum_score,
        timeframes_available=tf_count,
        annualized_volatility=annualized_volatility(log_returns(series)),
        max_drawdown=maximum_drawdown(series),
        price_performance=periods,
    )
    if asset is None:
        status = EvidenceStatus.INSUFFICIENT_DATA
    elif performance_unavailable or any(record.error for record in collector.records):
        status = EvidenceStatus.PARTIAL
    else:
        status = EvidenceStatus.OK
    return await _envelope(
        "analyze_asset",
        status,
        f"{params.symbol} asset profile.",
        data,
        [
            "supply",
            "relative_strength",
            "composite_momentum_score",
            "annualized_volatility",
            "max_drawdown",
        ],
        "latest quote and info; daily history when available",
        [resolved_id] if resolved_id is not None else [],
        collector,
        bound,
        notes,
    )


async def analyze_momentum(
    params: AnalyzeMomentumInput,
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[AnalyzeMomentumData]:
    bound = _bound(deps)
    symbols = list(dict.fromkeys([*params.symbols, "BTC"]))
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    ids, notes = await _resolve(bound, collector, symbols)
    assets = await _quoted(collector, ids, params.quote_currency)
    btc = quote_of(assets.get("BTC") or {}, params.quote_currency)
    rows: list[MomentumRow] = []
    resolved_count = 0
    for symbol in params.symbols:
        asset = assets.get(symbol)
        if asset is None:
            notes.append(f"{symbol} had no quote")
        else:
            resolved_count += 1
        rows.append(_momentum_row(symbol, asset, params.quote_currency, btc))
    if any(
        row.timeframes_available is not None and 0 < row.timeframes_available < 4 for row in rows
    ):
        notes.append(
            "One or more assets had fewer than 4 momentum timeframes (24h/7d/30d/60d); "
            "composite_momentum_score re-normalized available timeframes."
        )
    data = AnalyzeMomentumData(quote_currency=params.quote_currency, assets=rows)
    if resolved_count == 0:
        status = EvidenceStatus.INSUFFICIENT_DATA
    elif resolved_count < len(params.symbols) or any(record.error for record in collector.records):
        status = EvidenceStatus.PARTIAL
    else:
        status = EvidenceStatus.OK
    return await _envelope(
        "analyze_momentum",
        status,
        f"Momentum for {resolved_count} of {len(params.symbols)} assets.",
        data,
        [
            "multi_timeframe_return",
            "relative_strength",
            "composite_momentum_score",
            "acceleration_7d_vs_30d",
        ],
        "latest quotes",
        [row.cmc_id for row in rows if row.cmc_id is not None],
        collector,
        bound,
        notes,
    )


async def detect_market_anomalies(
    params: DetectAnomaliesInput,
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[DetectAnomaliesData]:
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    scan_notes: list[str] = []
    scan_limit, page = await _deep_scan_limit(
        params.deep_scan,
        params.universe_size,
        override_cmc_key,
        scan_notes,
    )
    rows = await _listings_universe(collector, params.quote_currency, scan_limit, page=page)
    btc = _find_raw(rows, "BTC")
    btc_change = None
    if btc is not None:
        btc_change = as_float(quote_of(btc, params.quote_currency).get("percent_change_24h"))
    eligible_rows: list[dict[str, object]] = []
    excluded_stables = 0
    unknown_class_count = 0
    corrupt_excluded = 0
    for row in rows:
        stable_cls = classify_stablecoin(_raw_tags(row))
        if stable_cls == "verified_stablecoin":
            excluded_stables += 1
            continue
        if _is_corrupt_listing_quote(row, params.quote_currency, allow_zero_volume=True):
            corrupt_excluded += 1
            continue
        if stable_cls == "unknown":
            unknown_class_count += 1
        eligible_rows.append(row)
    notes: list[str] = []
    notes.extend(scan_notes)
    if excluded_stables > 0:
        notes.append(
            f"{excluded_stables} verified stablecoin(s) excluded from anomaly distribution "
            "calculations using CoinMarketCap canonical stablecoin tags."
        )
    if corrupt_excluded > 0:
        notes.append(
            f"{corrupt_excluded} listing(s) with extreme corrupt return values (>5,000% 24h) "
            "excluded so statistical anomaly thresholds remain valid."
        )
    if unknown_class_count > 0:
        notes.append(
            f"{unknown_class_count} asset(s) had missing/empty classification tags "
            "(unknown stablecoin status) and were preserved in the eligible population."
        )
    ratios = [
        log_volume_to_mcap(
            volume_to_mcap(
                as_float(quote_of(row, params.quote_currency).get("volume_24h")),
                as_float(quote_of(row, params.quote_currency).get("market_cap")),
            )
        )
        for row in eligible_rows
    ]
    changes = [
        as_float(quote_of(row, params.quote_currency).get("percent_change_24h"))
        for row in eligible_rows
    ]
    valid_ratio_count = sum(1 for val in ratios if val is not None)
    valid_change_count = sum(1 for val in changes if val is not None)
    insufficient_sample = False
    if valid_ratio_count < MIN_ANOMALY_SAMPLE:
        volume_hits: list[AnomalyHit] = []
        insufficient_sample = True
        notes.append(
            f"Eligible non-stablecoin sample for ln_volume_to_mcap ({valid_ratio_count}) is "
            f"below minimum {MIN_ANOMALY_SAMPLE}; volume outlier detection withheld."
        )
    else:
        volume_hits = _outlier_hits(eligible_rows, ratios, "ln_volume_to_mcap")
    if valid_change_count < MIN_ANOMALY_SAMPLE:
        change_hits: list[AnomalyHit] = []
        insufficient_sample = True
        notes.append(
            f"Eligible non-stablecoin sample for percent_change_24h ({valid_change_count}) is "
            f"below minimum {MIN_ANOMALY_SAMPLE}; price-change outlier detection withheld."
        )
    else:
        change_hits = _outlier_hits(eligible_rows, changes, "percent_change_24h")
    high_vol_syms: list[str] = []
    low_vol_syms: list[str] = []
    unclear_vol_syms: list[str] = []
    for hit in volume_hits:
        direction = hit.direction
        if direction == "HIGH_VOLUME_TO_MCAP":
            high_vol_syms.append(hit.symbol)
        elif direction == "LOW_VOLUME_ILLIQUIDITY":
            low_vol_syms.append(hit.symbol)
        else:
            unclear_vol_syms.append(hit.symbol)
    if volume_hits:
        parts: list[str] = []
        if high_vol_syms:
            parts.append(
                f"high volume/mcap positive tail ({len(high_vol_syms)}): "
                + ", ".join(high_vol_syms)
            )
        if low_vol_syms:
            parts.append(
                f"low volume/possible illiquidity negative tail, NOT volume spikes "
                f"({len(low_vol_syms)}): " + ", ".join(low_vol_syms)
            )
        if unclear_vol_syms:
            parts.append(
                f"insufficient/mixed tail direction ({len(unclear_vol_syms)}): "
                + ", ".join(unclear_vol_syms)
            )
        notes.append(
            "Volume/MCap outlier direction breakdown (statistical anomalies alone are "
            "neither bullish nor bearish): " + "; ".join(parts) + "."
        )
    divergences = []
    for row in eligible_rows:
        change = as_float(quote_of(row, params.quote_currency).get("percent_change_24h"))
        symbol = str(row.get("symbol") or "")
        if symbol == "BTC" or not btc_divergence(change, btc_change):
            continue
        divergences.append(
            BtcDivergence(
                symbol=symbol,
                cmc_id=row.get("id") if isinstance(row.get("id"), int) else None,
                asset_change_24h_pct=change,
                btc_change_24h_pct=btc_change,
                divergence_pct=(
                    None if change is None or btc_change is None else change - btc_change
                ),
            )
        )
    data = DetectAnomaliesData(
        quote_currency=params.quote_currency,
        volume_mcap_outliers=volume_hits,
        price_change_outliers=change_hits,
        btc_divergences=divergences,
    )
    if not eligible_rows or (
        valid_ratio_count < MIN_ANOMALY_SAMPLE and valid_change_count < MIN_ANOMALY_SAMPLE
    ):
        status = EvidenceStatus.INSUFFICIENT_DATA
    elif insufficient_sample or any(record.error for record in collector.records):
        status = EvidenceStatus.PARTIAL
    else:
        status = EvidenceStatus.OK
    summary = (
        f"{len(volume_hits) + len(change_hits)} outliers "
        f"({len(high_vol_syms)} high-volume, {len(low_vol_syms)} low-volume/illiquidity, "
        f"{len(change_hits)} price-change) and {len(divergences)} BTC divergences."
    )
    return await _envelope(
        "detect_market_anomalies",
        status,
        summary,
        data,
        ["z_score", "modified_z_score", "btc_divergence"],
        f"top {params.universe_size} listings (verified stablecoins excluded)",
        [],
        collector,
        bound,
        notes,
    )


async def analyze_market_regime(
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
    quote_currency: str = "USD",
) -> EvidenceEnvelope[MarketRegimeData]:
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    global_payload, fear_payload, rows, hist_context = await asyncio.gather(
        collector.get(GLOBAL, {"convert": quote_currency}),
        collector.get(FEAR, {}),
        _listings_universe(collector, quote_currency, 50),
        _fetch_historical_context(collector, bound, quote_currency),
    )
    global_trends, fear_trends, trend_notes = hist_context
    metrics = global_quote(global_payload or {}, quote_currency)
    fg_value, _label = fear_greed(fear_payload or {})
    changes = [as_float(quote_of(row, quote_currency).get("percent_change_24h")) for row in rows]
    known_changes = [value for value in changes if value is not None]
    breadth = _breadth(changes)
    btc = _find_raw(rows, "BTC")
    btc_change = as_float(quote_of(btc, quote_currency).get("percent_change_24h")) if btc else None
    alt_changes = [
        as_float(quote_of(row, quote_currency).get("percent_change_24h"))
        for row in rows
        if row.get("symbol") != "BTC"
    ]
    alt_known = [value for value in alt_changes if value is not None]
    outperforming = None
    if btc_change is not None and alt_known:
        outperforming = btc_change > float(pd.Series(alt_known).median())
    stale_inputs = any(
        record.meta.freshness != "FRESH" for record in collector.records if record.meta is not None
    )
    assessment = classify_regime(
        total_mcap_change_24h_pct=metrics.get("total_market_cap_change_24h_pct"),
        btc_dominance_change_24h=metrics.get("btc_dominance_change_24h"),
        top50_breadth_positive_pct=breadth,
        fear_greed_value=fg_value,
        btc_outperforming_median_alt=outperforming,
        breadth_sample_size=len(known_changes),
        stale_inputs=stale_inputs,
        fear_greed_avg_7d=fear_trends.get("fear_greed_avg_7d"),
        fear_greed_avg_30d=fear_trends.get("fear_greed_avg_30d"),
        fear_greed_change_7d=fear_trends.get("fear_greed_change_7d"),
        total_mcap_change_7d_pct=global_trends.get("total_market_cap_change_7d_pct"),
    )
    data = MarketRegimeData(
        regime=assessment.regime,  # type: ignore[arg-type]
        total_mcap_change_24h_pct=metrics.get("total_market_cap_change_24h_pct"),
        btc_dominance_change_24h=metrics.get("btc_dominance_change_24h"),
        top50_breadth_positive_pct=breadth,
        fear_greed_value=fg_value,
        btc_outperforming_median_alt=outperforming,
        total_market_cap_change_7d_pct=global_trends.get("total_market_cap_change_7d_pct"),
        total_market_cap_change_30d_pct=global_trends.get("total_market_cap_change_30d_pct"),
        btc_dominance_change_7d=global_trends.get("btc_dominance_change_7d"),
        btc_dominance_change_30d=global_trends.get("btc_dominance_change_30d"),
        fear_greed_avg_7d=fear_trends.get("fear_greed_avg_7d"),
        fear_greed_avg_30d=fear_trends.get("fear_greed_avg_30d"),
        fear_greed_change_7d=fear_trends.get("fear_greed_change_7d"),
        fear_greed_change_30d=fear_trends.get("fear_greed_change_30d"),
        signal_conflict=assessment.signal_conflict,
        confidence=assessment.confidence,  # type: ignore[arg-type]
        dominant_signals=assessment.dominant_signals,
        conflicting_signals=assessment.conflicting_signals,
        rationale=assessment.rationale,
    )
    notes: list[str] = list(trend_notes)
    if assessment.signal_conflict:
        notes.append(
            "Market structure and sentiment signals conflict; treat regime classification "
            f"as {assessment.confidence or 'LOW'} confidence."
        )
    if data.regime is None:
        status = EvidenceStatus.INSUFFICIENT_DATA
        summary = "Regime inputs were incomplete."
    else:
        status = (
            EvidenceStatus.PARTIAL
            if any(record.error for record in collector.records)
            else EvidenceStatus.OK
        )
        summary = (
            f"{data.regime} (signal conflict; confidence {data.confidence})."
            if data.signal_conflict
            else f"{data.regime} (confidence {data.confidence})."
        )
    return await _envelope(
        "analyze_market_regime",
        status,
        summary,
        data,
        [
            "market_cap_change",
            "btc_dominance_change",
            "breadth",
            "fear_greed",
            "signal_conflict",
            "historical_trends_7d_30d",
        ],
        "latest; 7d-30d daily historical context (24h cached)",
        [],
        collector,
        bound,
        notes,
    )


async def analyze_sector_rotation(
    params: SectorRotationInput | None = None,
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[SectorRotationData]:
    request = params or SectorRotationInput()
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    sectors = await bound.sectors.load()
    if request.sectors:
        sectors = [sector for sector in sectors if sector.slug in request.sectors]
    rows = await _listings_universe(collector, request.quote_currency, 200)
    listings_ts = _latest_source_timestamp(collector, LISTINGS)
    market_volume = _sum_volume(rows, request.quote_currency)
    benchmark_constituents = [
        _constituent(row, request.quote_currency)
        for row in rows
        if classify_stablecoin(_raw_tags(row)) != "verified_stablecoin"
    ]
    benchmark = market_median_benchmark(benchmark_constituents)
    snapshots: list[SectorSnapshot] = []
    notes: list[str] = []
    membership_counts: dict[str, int] = {}
    under_sampled: list[str] = []
    skewed_benchmark_sectors: list[str] = []
    zero_vol_filtered: list[str] = []
    outlier_filtered: list[str] = []
    rwa_requested = any(sector.slug == "rwa" for sector in sectors)
    sector_results = await asyncio.gather(
        *[
            _sector_members(
                sector, rows, request.quote_currency, collector, bound, listings_ts
            )
            for sector in sectors
        ]
    )
    for sector, (constituents, member_keys, taxonomy_source, sector_ts) in zip(
        sectors, sector_results, strict=True
    ):
        for key in member_keys:
            membership_counts[key] = membership_counts.get(key, 0) + 1
        stats = aggregate_sector(
            constituents,
            market_volume_24h=market_volume,
            min_constituents=MIN_SECTOR_CONSTITUENTS,
        )
        if not stats.sample_sufficient:
            under_sampled.append(f"{sector.slug} (n={stats.constituent_count})")
        if stats.zero_volume_excluded > 0:
            zero_vol_filtered.append(f"{sector.slug} ({stats.zero_volume_excluded})")
        if stats.outlier_excluded > 0:
            outlier_filtered.append(f"{sector.slug} ({stats.outlier_excluded})")
        same_source = taxonomy_source == "listings_tag_fallback"
        if timestamps_aligned(
            sector_ts,
            listings_ts,
            same_source=same_source,
            max_skew_seconds=MAX_BENCHMARK_TIMESTAMP_SKEW_SECONDS,
        ):
            excess_24h = excess_return(stats.median_change_24h_pct, benchmark.median_change_24h_pct)
            excess_7d = excess_return(stats.median_change_7d_pct, benchmark.median_change_7d_pct)
        else:
            excess_24h = None
            excess_7d = None
            skewed_benchmark_sectors.append(sector.slug)
        rotation_signal = classify_rotation_signal(
            stats.median_change_24h_pct,
            stats.median_change_7d_pct,
            stats.breadth_positive_24h_pct,
            excess_24h=excess_24h,
            excess_7d=excess_7d,
            sample_sufficient=stats.sample_sufficient,
        )
        snapshots.append(
            SectorSnapshot(
                sector_slug=sector.slug,  # type: ignore[arg-type]
                display_name=sector.display_name,
                constituent_count=stats.constituent_count,
                median_change_24h_pct=stats.median_change_24h_pct,
                median_change_7d_pct=stats.median_change_7d_pct,
                excess_change_24h_vs_market_pct=excess_24h,
                excess_change_7d_vs_market_pct=excess_7d,
                cap_weighted_change_24h_pct=stats.cap_weighted_change_24h_pct,
                cap_weighted_change_7d_pct=stats.cap_weighted_change_7d_pct,
                breadth_positive_24h_pct=stats.breadth_positive_24h_pct,
                total_volume_24h=stats.total_volume_24h,
                sector_volume_share_pct=stats.sector_volume_share_pct,
                rotation_signal=rotation_signal,  # type: ignore[arg-type]
                taxonomy_source=taxonomy_source,  # type: ignore[arg-type]
                sample_sufficient=stats.sample_sufficient,
            )
        )
    unique_count = len(membership_counts)
    overlap_count = sum(1 for count in membership_counts.values() if count > 1)
    if overlap_count > 0:
        notes.append(
            f"{overlap_count} of {unique_count} unique constituents appear in multiple sectors "
            "due to CoinMarketCap multi-tag overlap; sector volume shares are not "
            "mutually exclusive."
        )
    if skewed_benchmark_sectors:
        notes.append(
            "Sector excess returns vs market benchmark were set to null due to source "
            f"timestamp skew exceeding {int(MAX_BENCHMARK_TIMESTAMP_SKEW_SECONDS)}s or missing "
            f"source timestamps between /category and /listings/latest for: "
            f"{', '.join(skewed_benchmark_sectors)}."
        )
    if under_sampled:
        notes.append(
            f"Sectors below minimum sample size ({MIN_SECTOR_CONSTITUENTS} constituents) are "
            f"marked INSUFFICIENT_DATA rather than directional rotation: "
            f"{', '.join(under_sampled)}."
        )
    if zero_vol_filtered:
        notes.append(
            "Excluded zero-volume category constituents from cap-weighted sector returns to "
            "prevent untraded quote distortion: "
            f"{', '.join(zero_vol_filtered)}."
        )
    if outlier_filtered:
        notes.append(
            "Excluded extreme-return or illiquid large-cap category outliers from cap-weighted "
            "sector returns to prevent upstream CMC data corruption: "
            f"{', '.join(outlier_filtered)}."
        )
    rwa_universe: RwaUniverseContext | None = None
    if rwa_requested:
        notes.append(
            "CMC v5 RWA endpoints (/v5/real-world-assets/assets/list, /v5/real-world-assets/map) "
            "track underlying real-world assets keyed by rwa_id without crypto cmc_id, so crypto "
            "RWA protocol sector returns rely on sector_mappings/listings tags while underlying "
            "RWA universe context is returned separately in rwa_universe."
        )
        rwa_list_payload: dict[str, object] | None = None
        rwa_map_payload: dict[str, object] | None = None
        rwa_sources: list[str] = []

        async def _get_rwa_list() -> dict[str, object] | None:
            if not _capability_allows(bound, RWA_ASSETS_LIST, collector.override):
                notes.append(
                    f"{RWA_ASSETS_LIST} is outside the current CoinMarketCap plan; "
                    "underlying RWA tokenized quotes unavailable."
                )
                return None
            payload, err = await collector.get_optional(
                RWA_ASSETS_LIST,
                {"limit": 25},
                context_label="underlying RWA asset list",
            )
            if err:
                notes.append(err)
            return payload

        async def _get_rwa_map() -> dict[str, object] | None:
            if not _capability_allows(bound, RWA_MAP, collector.override):
                notes.append(
                    f"{RWA_MAP} is outside the current CoinMarketCap plan; "
                    "underlying RWA catalog map unavailable."
                )
                return None
            payload, err = await collector.get_optional(
                RWA_MAP,
                {"limit": 100},
                context_label="underlying RWA catalog map",
            )
            if err:
                notes.append(err)
            return payload

        rwa_list_payload, rwa_map_payload = await asyncio.gather(_get_rwa_list(), _get_rwa_map())
        if rwa_list_payload is not None:
            rwa_sources.append(RWA_ASSETS_LIST)
        if rwa_map_payload is not None:
            rwa_sources.append(RWA_MAP)
        if rwa_sources:
            parsed_rwa = parse_rwa_universe(
                rwa_list_payload,
                rwa_map_payload,
                request.quote_currency,
            )
            notes.extend(parsed_rwa.limitations)
            if parsed_rwa.sampled_rwa_assets > 0:
                rwa_universe = RwaUniverseContext(
                    total_rwa_assets=parsed_rwa.total_rwa_assets,
                    sampled_rwa_assets=parsed_rwa.sampled_rwa_assets,
                    asset_type_counts=parsed_rwa.asset_type_counts,
                    total_tokenized_market_cap=parsed_rwa.total_tokenized_market_cap,
                    total_tokenized_volume_24h=parsed_rwa.total_tokenized_volume_24h,
                    top_rwa_assets=[RwaAssetBrief(**item) for item in parsed_rwa.top_rwa_assets],
                    source_endpoints=rwa_sources,
                )
    used_snapshot_fallback = any(
        record.meta is not None and record.meta.data_mode == "VERIFIED_SNAPSHOT_FALLBACK"
        for record in collector.records
    )
    if used_snapshot_fallback:
        notes.append(
            "Sector rotation relied on verified snapshot fallback for one or more tier-restricted "
            "category endpoints; inspect evidence.freshness and source_timestamps."
        )
    data = SectorRotationData(
        quote_currency=request.quote_currency,
        sectors=snapshots,
        unique_constituent_count=unique_count,
        overlapping_asset_count=overlap_count,
        rwa_universe=rwa_universe,
    )
    if not snapshots or all(item.constituent_count == 0 for item in snapshots):
        status = EvidenceStatus.INSUFFICIENT_DATA
    elif (
        under_sampled
        or skewed_benchmark_sectors
        or outlier_filtered
        or used_snapshot_fallback
        or any(record.error for record in collector.records)
    ):
        status = EvidenceStatus.PARTIAL
    else:
        status = EvidenceStatus.OK
    return await _envelope(
        "analyze_sector_rotation",
        status,
        f"{len(snapshots)} sector snapshots ({unique_count} unique constituents).",
        data,
        [
            "median_change",
            "excess_change_vs_market",
            "cap_weighted_change",
            "breadth",
            "rotation_signal",
        ],
        "category endpoint or top 200 listings by tag",
        [],
        collector,
        bound,
        notes,
    )


async def get_historical_performance(
    params: HistoricalPerformanceInput,
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[HistoricalPerformanceData]:
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    ids, notes = await _resolve(bound, collector, [params.symbol, "BTC"])
    asset_id = ids.get(params.symbol)
    btc_id = ids.get("BTC")
    asset_points = await _history(collector, bound, asset_id, params)
    btc_points = await _history(collector, bound, btc_id, params)
    asset = utc_daily_close(asset_points)
    benchmark = utc_daily_close(btc_points)

    used_warehouse = False
    warehouse_source = DAILY_CLOSE_SOURCE
    if asset.empty and bound.daily_closes is not None and asset_id is not None:
        warehouse_rows: list[DailyCloseRow] = await bound.daily_closes.list_asset_closes(
            asset_id,
            limit=max(params.count, MIN_WAREHOUSE_DAYS),
        )
        dedup_asset = {row.utc_date: row for row in warehouse_rows if row.close_price > 0}
        valid_asset_rows = [dedup_asset[d] for d in sorted(dedup_asset)]
        if len(valid_asset_rows) >= MIN_WAREHOUSE_DAYS:
            used_warehouse = True
            warehouse_source = valid_asset_rows[-1].source or DAILY_CLOSE_SOURCE
            asset_points = [
                (
                    datetime(row.utc_date.year, row.utc_date.month, row.utc_date.day, tzinfo=UTC),
                    row.close_price,
                )
                for row in valid_asset_rows
            ]
            asset = utc_daily_close(asset_points)
            latest_obs = max(
                (
                    row.observed_at
                    or datetime(
                        row.utc_date.year,
                        row.utc_date.month,
                        row.utc_date.day,
                        tzinfo=UTC,
                    )
                    for row in valid_asset_rows
                ),
                default=bound.now(),
            )
            age = max(bound.now() - latest_obs, bound.now() - bound.now())
            collector.records.append(
                CallRecord(
                    endpoint="warehouse://daily_asset_closes",
                    payload={
                        "cmc_id": asset_id,
                        "days": len(valid_asset_rows),
                        "source": warehouse_source,
                    },
                    meta=FetchMeta(
                        data_mode="VERIFIED_SNAPSHOT_FALLBACK",
                        freshness=freshness_for_age(age),
                        cache_hit=False,
                        credit_cost=0,
                        source_timestamp=latest_obs,
                        retrieved_at=latest_obs,
                    ),
                )
            )
            notes.append(
                f"Historical performance computed from daily_asset_closes warehouse "
                f"({len(valid_asset_rows)} observed daily listings-snapshot reference closes, "
                f"source={warehouse_source}); this is an observed snapshot/reference series, "
                "not official CoinMarketCap OHLCV historical closes. "
                "Volatility annualized with sqrt(365)."
            )
            if benchmark.empty and btc_id is not None:
                btc_rows = await bound.daily_closes.list_asset_closes(
                    btc_id,
                    limit=max(params.count, MIN_WAREHOUSE_DAYS),
                )
                dedup_btc = {row.utc_date: row for row in btc_rows if row.close_price > 0}
                valid_btc_rows = [dedup_btc[d] for d in sorted(dedup_btc)]
                if len(valid_btc_rows) >= MIN_WAREHOUSE_DAYS:
                    btc_points = [
                        (
                            datetime(
                                row.utc_date.year,
                                row.utc_date.month,
                                row.utc_date.day,
                                tzinfo=UTC,
                            ),
                            row.close_price,
                        )
                        for row in valid_btc_rows
                    ]
                    benchmark = utc_daily_close(btc_points)
                else:
                    notes.append(
                        f"BTC benchmark in daily_asset_closes has {len(valid_btc_rows)} "
                        f"observed day(s) (< {MIN_WAREHOUSE_DAYS} required); beta_vs_btc and "
                        "correlation_vs_btc left null."
                    )
        elif valid_asset_rows:
            notes.append(
                f"daily_asset_closes warehouse currently holds {len(valid_asset_rows)} observed "
                f"day(s) for {params.symbol} (minimum {MIN_WAREHOUSE_DAYS} required); "
                "warehouse historical metrics withheld."
            )

    overlap = asset.index.intersection(benchmark.index) if not asset.empty else asset.index
    paired_asset = asset.reindex(overlap)
    paired_btc = benchmark.reindex(overlap)
    return_series = paired_asset if len(paired_asset) >= 2 else asset
    data = HistoricalPerformanceData(
        symbol=params.symbol,
        cmc_id=asset_id,
        quote_currency=params.quote_currency,
        overlap_days=int(len(overlap)),
        simple_return=_window_return(return_series, logarithmic=False),
        log_return=_window_return(return_series, logarithmic=True),
        annualized_volatility=annualized_volatility(log_returns(asset)),
        max_drawdown=maximum_drawdown(asset),
        beta_vs_btc=beta(simple_returns(paired_asset), simple_returns(paired_btc)),
        correlation_vs_btc=pearson_correlation(
            simple_returns(paired_asset),
            simple_returns(paired_btc),
        ),
    )
    tier_blocked = any(
        record.error
        and OHLCV in record.endpoint
        and (
            record.error_category == "tier_restricted"
            or (record.error_category is None and "plan" in record.error.lower())
        )
        for record in collector.records
    )
    if asset_id is None:
        status = EvidenceStatus.INSUFFICIENT_DATA
    elif asset.empty:
        status = (
            EvidenceStatus.TIER_RESTRICTED if tier_blocked else EvidenceStatus.INSUFFICIENT_DATA
        )
    elif used_warehouse or data.annualized_volatility is None:
        status = EvidenceStatus.PARTIAL
    else:
        status = EvidenceStatus.OK
    window = (
        f"{len(asset)} observed daily reference closes (daily_asset_closes warehouse; "
        f"source={warehouse_source}; not official CMC OHLCV)"
        if used_warehouse
        else f"{params.count} daily closes"
    )
    metrics = [
        "simple_return",
        "log_return",
        "annualized_volatility",
        "max_drawdown",
        "beta",
        "correlation",
    ]
    if used_warehouse:
        metrics.append("daily_asset_closes_observed_reference")
    return await _envelope(
        "get_historical_performance",
        status,
        (
            f"{params.symbol} observed warehouse history over {len(asset)} daily closes "
            f"({data.overlap_days or 0} shared with BTC)."
            if used_warehouse
            else f"{params.symbol} history over {data.overlap_days or 0} shared days."
        ),
        data,
        metrics,
        window,
        [ids[params.symbol]] if params.symbol in ids else [],
        collector,
        bound,
        notes,
    )


async def analyze_derivatives(
    params: DerivativesAnalysisInput,
    override_cmc_key: str | None = None,
    deps: ServiceDeps | None = None,
) -> EvidenceEnvelope[DerivativesAnalysisData]:
    bound = _bound(deps)
    collector = Collector(bound.gateway, override_cmc_key, bound.capabilities)
    ids, notes = await _resolve(bound, collector, [params.symbol])
    cmc_id = ids.get(params.symbol)
    if cmc_id is None:
        return await _envelope(
            "analyze_derivatives",
            EvidenceStatus.INSUFFICIENT_DATA,
            f"{params.symbol} could not be resolved for derivatives analysis.",
            DerivativesAnalysisData(
                symbol=params.symbol,
                cmc_id=None,
                quote_currency=params.quote_currency,
                mode="spot_stress_proxy",
            ),
            ["funding_rate", "open_interest", "liquidations_24h"],
            "symbol resolution",
            [],
            collector,
            bound,
            notes,
        )

    async def _get_asset_derivatives() -> dict[str, object] | None:
        if cmc_id is not None and _capability_allows(bound, DERIVATIVES, collector.override):
            return await collector.get(
                DERIVATIVES,
                {"crypto_id": cmc_id, "limit": DERIVATIVES_PAIR_LIMIT},
            )
        return None

    async def _get_market_liquidations() -> dict[str, object] | None:
        if not _capability_allows(bound, LIQUIDATIONS, collector.override):
            notes.append(
                f"{LIQUIDATIONS} is outside the current CoinMarketCap plan; "
                "market-wide liquidation quotes left null."
            )
            return None
        payload, err = await collector.get_optional(
            LIQUIDATIONS,
            {},
            context_label="market-wide liquidations",
        )
        if err:
            notes.append(err)
        return payload

    async def _get_derivatives_venues() -> dict[str, object] | None:
        if not _capability_allows(bound, DERIVATIVES_EXCHANGES, collector.override):
            notes.append(
                f"{DERIVATIVES_EXCHANGES} is outside the current CoinMarketCap plan; "
                "derivatives venues context left null."
            )
            return None
        payload, err = await collector.get_optional(
            DERIVATIVES_EXCHANGES,
            {"limit": 10},
            context_label="derivatives exchanges",
        )
        if err:
            notes.append(err)
        return payload

    derivative_payload, liquidations_payload, venues_payload = await asyncio.gather(
        _get_asset_derivatives(),
        _get_market_liquidations(),
        _get_derivatives_venues(),
    )

    market_wide_liquidations: MarketWideLiquidationsContext | None = None
    if liquidations_payload is not None:
        parsed_liq = parse_market_wide_liquidations(liquidations_payload, params.quote_currency)
        notes.extend(parsed_liq.limitations)
        if parsed_liq.has_data:
            market_wide_liquidations = MarketWideLiquidationsContext(
                quote_currency=parsed_liq.quote_currency,
                total_24h=parsed_liq.total_24h,
                long_24h=parsed_liq.long_24h,
                short_24h=parsed_liq.short_24h,
                total_1h=parsed_liq.total_1h,
                total_4h=parsed_liq.total_4h,
                last_updated=parsed_liq.last_updated,
            )

    derivatives_venues: DerivativesVenuesContext | None = None
    if venues_payload is not None:
        parsed_venues = parse_derivatives_exchanges(venues_payload, params.quote_currency)
        notes.extend(parsed_venues.limitations)
        if parsed_venues.sampled_exchanges > 0:
            derivatives_venues = DerivativesVenuesContext(
                quote_currency=parsed_venues.quote_currency,
                total_exchanges=parsed_venues.total_exchanges,
                sampled_exchanges=parsed_venues.sampled_exchanges,
                total_open_interest=parsed_venues.total_open_interest,
                total_volume_24h=parsed_venues.total_volume_24h,
                venues=[DerivativeVenueBrief(**item) for item in parsed_venues.venues],
            )

    if derivative_payload is None:
        notes.append(
            "Derivatives endpoints are unavailable on this CoinMarketCap plan. "
            "Spot volume and realized volatility are the stress proxy."
        )
        assets = await _quoted(collector, ids, params.quote_currency)
        quote = quote_of(assets.get(params.symbol) or {}, params.quote_currency)
        closes = await _closes(collector, bound, cmc_id, params.quote_currency)
        data = DerivativesAnalysisData(
            symbol=params.symbol,
            cmc_id=cmc_id,
            quote_currency=params.quote_currency,
            mode="spot_stress_proxy",
            market_wide_liquidations=market_wide_liquidations,
            derivatives_venues=derivatives_venues,
            spot_volume_24h=as_float(quote.get("volume_24h")),
            annualized_volatility=annualized_volatility(log_returns(utc_daily_close(closes))),
        )
        proxy_metrics = ["spot_volume_24h", "annualized_volatility"]
        if market_wide_liquidations is not None:
            proxy_metrics.append("market_wide_liquidations")
        if derivatives_venues is not None:
            proxy_metrics.append("derivatives_venues")
        return await _envelope(
            "analyze_derivatives",
            EvidenceStatus.PARTIAL,
            f"{params.symbol} spot stress proxy.",
            data,
            proxy_metrics,
            "spot quote; daily history and market-wide derivatives context when available",
            [cmc_id] if cmc_id is not None else [],
            collector,
            bound,
            notes,
        )
    parsed = parse_derivatives_pairs(
        derivative_payload,
        params.quote_currency,
        expected_symbol=params.symbol,
        expected_cmc_id=cmc_id,
    )
    notes.extend(parsed.limitations)
    pair_models = [DerivativePairObservation(**obs) for obs in parsed.market_pairs]
    data = DerivativesAnalysisData(
        symbol=params.symbol,
        cmc_id=cmc_id,
        quote_currency=params.quote_currency,
        mode="derivatives",
        funding_rate=parsed.funding_rate,
        open_interest=parsed.open_interest,
        liquidations_24h=parsed.liquidations_24h,
        market_pair_count=parsed.market_pair_count,
        sampled_pair_count=parsed.sampled_pair_count,
        open_interest_pairs_included=parsed.open_interest_pairs_included,
        outlier_pairs_excluded=parsed.outlier_pairs_excluded,
        market_pairs=pair_models,
        market_wide_liquidations=market_wide_liquidations,
        derivatives_venues=derivatives_venues,
    )
    used_snapshot_fallback = any(
        record.meta is not None and record.meta.data_mode == "VERIFIED_SNAPSHOT_FALLBACK"
        for record in collector.records
    )
    if used_snapshot_fallback:
        notes.append(
            "Derivatives metrics were served from a verified snapshot fallback because the live "
            "derivatives endpoint was tier-restricted or unavailable; inspect evidence.freshness."
        )
    has_any_metric = any(
        value is not None
        for value in (data.funding_rate, data.open_interest, data.liquidations_24h)
    )
    if not has_any_metric and not pair_models:
        status = EvidenceStatus.INSUFFICIENT_DATA
    elif (
        used_snapshot_fallback
        or parsed.is_v5_nested
        or data.funding_rate is None
        or data.open_interest is None
        or data.liquidations_24h is None
        or (
            data.market_pair_count is not None
            and data.sampled_pair_count is not None
            and data.sampled_pair_count < data.market_pair_count
        )
    ):
        status = EvidenceStatus.PARTIAL
    else:
        status = EvidenceStatus.OK
    deriv_metrics = [
        "funding_rate",
        "open_interest",
        "liquidations_24h",
        "market_pair_count",
        "sampled_pair_count",
    ]
    if market_wide_liquidations is not None:
        deriv_metrics.append("market_wide_liquidations")
    if derivatives_venues is not None:
        deriv_metrics.append("derivatives_venues")
    return await _envelope(
        "analyze_derivatives",
        status,
        f"{params.symbol} derivatives context.",
        data,
        deriv_metrics,
        f"top {DERIVATIVES_PAIR_LIMIT} derivatives market pairs",
        [cmc_id] if cmc_id is not None else [],
        collector,
        bound,
        notes,
    )


async def _resolve(
    deps: ServiceDeps,
    collector: Collector,
    symbols: list[str],
) -> tuple[dict[str, int], list[str]]:
    resolution = await deps.assets.resolve(symbols)
    missing = [symbol for symbol in symbols if symbol not in resolution.ids]
    notes = list(resolution.limitations)
    if missing:
        payload = await collector.get(MAP, {"symbol": ",".join(missing)})
        extra = choose_ids(missing, map_rows(payload or {}))
        resolution.ids.update(extra.ids)
        notes.extend(extra.limitations)
    return resolution.ids, notes


async def _quoted(
    collector: Collector,
    ids: dict[str, int],
    currency: str,
) -> dict[str, dict[str, object]]:
    if not ids:
        return {}
    ordered = sorted(set(ids.values()))
    payload = await collector.get(
        QUOTES,
        {"id": ",".join(str(item) for item in ordered), "convert": currency},
    )
    found: dict[str, dict[str, object]] = {}
    for asset in keyed_assets(payload or {}):
        symbol = str(asset.get("symbol") or "").upper()
        if symbol:
            found[symbol] = asset
    return found


async def _closes(
    collector: Collector,
    deps: ServiceDeps,
    cmc_id: int | None,
    currency: str,
) -> list[tuple[datetime, float]]:
    if cmc_id is None or _plan_blocked(collector, deps, OHLCV):
        return []
    payload = await collector.get(
        OHLCV,
        {"id": cmc_id, "count": 30, "interval": "daily", "convert": currency},
    )
    return ohlcv_points(payload or {}, currency)


async def _history(
    collector: Collector,
    deps: ServiceDeps,
    cmc_id: int | None,
    params: HistoricalPerformanceInput,
) -> list[tuple[datetime, float]]:
    if cmc_id is None or _plan_blocked(collector, deps, OHLCV):
        return []
    payload = await collector.get(
        OHLCV,
        {
            "id": cmc_id,
            "count": params.count,
            "interval": params.interval,
            "convert": params.quote_currency,
        },
    )
    return ohlcv_points(payload or {}, params.quote_currency)


def _member_key(row: dict[str, object]) -> str:
    raw_id = row.get("id")
    if isinstance(raw_id, int):
        return f"id:{raw_id}"
    return f"sym:{str(row.get('symbol') or '').upper()}"


def _latest_source_timestamp(collector: Collector, endpoint: str) -> datetime | None:
    for record in reversed(collector.records):
        if record.endpoint == endpoint and record.meta is not None:
            return record.meta.source_timestamp
    return None


async def _sector_members(
    sector: SectorDef,
    rows: list[dict[str, object]],
    currency: str,
    collector: Collector,
    deps: ServiceDeps,
    listings_ts: datetime | None,
) -> tuple[list[Constituent], list[str], str, datetime | None]:
    if sector.category_id and _capability_allows(deps, CATEGORY, collector.override):
        payload, record = await collector.get_with_record(
            CATEGORY,
            {"id": sector.category_id, "limit": 100, "convert": currency},
        )
        cat_ts = record.meta.source_timestamp if record.meta is not None else None
        category_rows = listing_rows(payload or {})
        if not category_rows:
            data = (payload or {}).get("data")
            coins = data.get("coins") if isinstance(data, dict) else None
            if isinstance(coins, list):
                category_rows = [row for row in coins if isinstance(row, dict)]
        if category_rows:
            deduped: list[Constituent] = []
            keys: list[str] = []
            seen: set[str] = set()
            for row in category_rows:
                key = _member_key(row)
                if key in seen:
                    continue
                seen.add(key)
                keys.append(key)
                deduped.append(_constituent(row, currency))
            return deduped, keys, "cmc_category", cat_ts
    wanted = {tag.lower() for tag in sector.fallback_tags}
    matched: list[Constituent] = []
    keys = []
    seen = set()
    for row in rows:
        tags = {str(tag).lower() for tag in row.get("tags") or []}
        if tags & wanted:
            key = _member_key(row)
            if key in seen:
                continue
            seen.add(key)
            keys.append(key)
            matched.append(_constituent(row, currency))
    return matched, keys, "listings_tag_fallback", listings_ts


def _plan_blocked(collector: Collector, deps: ServiceDeps, endpoint: str) -> bool:
    if _capability_allows(deps, endpoint, collector.override):
        return False
    message = _capability_block_reason(deps, endpoint, collector.override)
    collector.records.append(CallRecord(endpoint, error=message, error_category="tier_restricted"))
    return True


def _constituent(row: dict[str, object], currency: str) -> Constituent:
    quote = quote_of(row, currency)
    return Constituent(
        market_cap=as_float(quote.get("market_cap")),
        volume_24h=as_float(quote.get("volume_24h")),
        percent_change_24h=as_float(quote.get("percent_change_24h")),
        percent_change_7d=as_float(quote.get("percent_change_7d")),
    )


def _comparison(
    symbol: str,
    asset: dict[str, object],
    currency: str,
    series: pd.Series,
    btc_quote: dict[str, object],
) -> AssetComparison:
    quote = quote_of(asset, currency)
    change_24h = as_float(quote.get("percent_change_24h"))
    change_7d = as_float(quote.get("percent_change_7d"))
    change_30d = as_float(quote.get("percent_change_30d"))
    change_60d = as_float(quote.get("percent_change_60d"))
    score, tf_count = composite_momentum_score(
        {
            "24h": change_24h,
            "7d": change_7d,
            "30d": change_30d,
            "60d": change_60d,
        }
    )
    return AssetComparison(
        cmc_id=asset.get("id") if isinstance(asset.get("id"), int) else None,
        symbol=symbol,
        name=_text(asset, "name"),
        price=as_float(quote.get("price")),
        market_cap=as_float(quote.get("market_cap")),
        volume_24h=as_float(quote.get("volume_24h")),
        volume_to_mcap=volume_to_mcap(
            as_float(quote.get("volume_24h")),
            as_float(quote.get("market_cap")),
        ),
        fdv_to_mcap_ratio=fdv_to_mcap_ratio(
            as_float(quote.get("fully_diluted_market_cap")),
            as_float(quote.get("market_cap")),
        ),
        circulating_supply_pct=circulating_supply_pct(
            as_float(asset.get("circulating_supply")),
            as_float(asset.get("max_supply")),
        ),
        percent_change_24h=change_24h,
        percent_change_7d=change_7d,
        percent_change_30d=change_30d,
        percent_change_60d=change_60d,
        rs_vs_btc_24h=relative_strength(
            change_24h,
            as_float(btc_quote.get("percent_change_24h")),
        ),
        rs_vs_btc_7d=relative_strength(
            change_7d,
            as_float(btc_quote.get("percent_change_7d")),
        ),
        rs_vs_btc_30d=relative_strength(
            change_30d,
            as_float(btc_quote.get("percent_change_30d")),
        ),
        composite_momentum_score=score,
        timeframes_available=tf_count,
        annualized_volatility=annualized_volatility(log_returns(series)),
        max_drawdown=maximum_drawdown(series),
    )


def _momentum_row(
    symbol: str,
    asset: dict[str, object] | None,
    currency: str,
    btc: dict[str, object],
) -> MomentumRow:
    quote = quote_of(asset or {}, currency)
    change_24h = as_float(quote.get("percent_change_24h"))
    change_7d = as_float(quote.get("percent_change_7d"))
    change_30d = as_float(quote.get("percent_change_30d"))
    change_60d = as_float(quote.get("percent_change_60d"))
    score, tf_count = composite_momentum_score(
        {
            "24h": change_24h,
            "7d": change_7d,
            "30d": change_30d,
            "60d": change_60d,
        }
    )
    return MomentumRow(
        symbol=symbol,
        cmc_id=(asset or {}).get("id") if isinstance((asset or {}).get("id"), int) else None,
        percent_change_1h=as_float(quote.get("percent_change_1h")),
        percent_change_24h=change_24h,
        percent_change_7d=change_7d,
        percent_change_30d=change_30d,
        percent_change_60d=change_60d,
        percent_change_90d=as_float(quote.get("percent_change_90d")),
        rs_vs_btc_24h=relative_strength(
            change_24h,
            as_float(btc.get("percent_change_24h")),
        ),
        rs_vs_btc_7d=relative_strength(change_7d, as_float(btc.get("percent_change_7d"))),
        rs_vs_btc_30d=relative_strength(change_30d, as_float(btc.get("percent_change_30d"))),
        composite_momentum_score=score,
        timeframes_available=tf_count,
        acceleration_7d_vs_30d=relative_strength(change_7d, change_30d),
    )


def _outlier_hits(
    rows: list[dict[str, object]],
    values: list[float | None],
    metric: str,
) -> list[AnomalyHit]:
    z_scores = standard_zscores(values)
    robust = modified_zscores(values)
    hits: list[AnomalyHit] = []
    for row, value, z_score, modified in zip(rows, values, z_scores, robust, strict=True):
        extreme = (z_score is not None and abs(z_score) >= OUTLIER_Z) or (
            modified is not None and abs(modified) >= OUTLIER_MODIFIED_Z
        )
        if not extreme:
            continue
        direction = (
            classify_volume_anomaly_direction(z_score, modified)
            if metric == "ln_volume_to_mcap"
            else None
        )
        hits.append(
            AnomalyHit(
                symbol=str(row.get("symbol") or ""),
                cmc_id=row.get("id") if isinstance(row.get("id"), int) else None,
                metric=metric,
                value=value,
                z_score=z_score,
                modified_z_score=modified,
                direction=direction,
            )
        )
    return hits


def _brief(row: dict[str, object], currency: str) -> QuoteBrief:
    quote = quote_of(row, currency)
    return QuoteBrief(
        cmc_id=row.get("id") if isinstance(row.get("id"), int) else None,
        symbol=str(row.get("symbol") or ""),
        name=_text(row, "name"),
        price=as_float(quote.get("price")),
        market_cap=as_float(quote.get("market_cap")),
        volume_24h=as_float(quote.get("volume_24h")),
        percent_change_24h=as_float(quote.get("percent_change_24h")),
    )


def _is_corrupt_listing_quote(
    row: dict[str, object],
    currency: str,
    *,
    allow_zero_volume: bool = False,
) -> bool:
    """Filter untraded zero-volume listings and implausible CMC upstream return spikes."""
    quote = quote_of(row, currency)
    volume_24h = as_float(quote.get("volume_24h"))
    market_cap = as_float(quote.get("market_cap"))
    change_24h = as_float(quote.get("percent_change_24h"))
    change_7d = as_float(quote.get("percent_change_7d"))
    change_30d = as_float(quote.get("percent_change_30d"))
    change_60d = as_float(quote.get("percent_change_60d"))
    if not allow_zero_volume and volume_24h is not None and volume_24h <= 0.0:
        return True
    if change_24h is not None and abs(change_24h) > 5000.0:
        return True
    if not allow_zero_volume:
        if change_7d is not None and abs(change_7d) > 20000.0:
            return True
        if change_30d is not None and abs(change_30d) > 20000.0:
            return True
        if change_60d is not None and abs(change_60d) > 50000.0:
            return True
        if (
            market_cap is not None
            and market_cap >= 1_000_000.0
            and volume_24h is not None
            and volume_24h < 1_000.0
            and change_24h is not None
            and abs(change_24h) > 100.0
        ):
            return True
    return False


def _universe(row: dict[str, object], currency: str) -> UniverseAsset:
    quote = quote_of(row, currency)
    return UniverseAsset(
        symbol=str(row.get("symbol") or ""),
        cmc_id=row.get("id") if isinstance(row.get("id"), int) else None,
        name=_text(row, "name"),
        market_cap=as_float(quote.get("market_cap")),
        volume_24h=as_float(quote.get("volume_24h")),
        percent_change_24h=as_float(quote.get("percent_change_24h")),
        percent_change_7d=as_float(quote.get("percent_change_7d")),
        percent_change_30d=as_float(quote.get("percent_change_30d")),
        percent_change_60d=as_float(quote.get("percent_change_60d")),
    )


def _breadth(changes: list[float | None]) -> float | None:
    known = [value for value in changes if value is not None]
    if not known:
        return None
    return 100.0 * sum(1 for value in known if value > 0) / len(known)


def _find(rows: list[QuoteBrief], symbol: str) -> QuoteBrief | None:
    return next((row for row in rows if row.symbol == symbol), None)


def _find_raw(rows: list[dict[str, object]], symbol: str) -> dict[str, object] | None:
    return next((row for row in rows if row.get("symbol") == symbol), None)


def _text(row: dict[str, object] | None, key: str) -> str | None:
    if row is None:
        return None
    value = row.get(key)
    return value if isinstance(value, str) else None


def _raw_tags(row: dict[str, object]) -> list[str] | None:
    tags = row.get("tags")
    if not isinstance(tags, list):
        return None
    return [str(tag) for tag in tags]


def _tags(payload: dict[str, object], cmc_id: int | None) -> list[str]:
    for asset in keyed_assets(payload):
        if cmc_id is not None and asset.get("id") not in {cmc_id, str(cmc_id)}:
            continue
        tags = asset.get("tags")
        if isinstance(tags, list):
            return [str(tag) for tag in tags]
    return []


def _sum_volume(rows: list[dict[str, object]], currency: str) -> float | None:
    values = [as_float(quote_of(row, currency).get("volume_24h")) for row in rows]
    known = [value for value in values if value is not None]
    if not known:
        return None
    return float(sum(known))


def _window_return(prices: pd.Series, *, logarithmic: bool) -> float | None:
    clean = prices.dropna()
    if len(clean) < 2 or float(clean.iloc[0]) <= 0 or float(clean.iloc[-1]) <= 0:
        return None
    ratio = float(clean.iloc[-1]) / float(clean.iloc[0])
    if logarithmic:
        import math

        return math.log(ratio)
    return ratio - 1


_CAPABILITY_TOOLS = (
    "get_market_overview",
    "analyze_market_regime",
    "scan_market_movers",
    "detect_market_anomalies",
    "compare_assets",
    "analyze_asset",
    "analyze_momentum",
    "analyze_sector_rotation",
    "get_historical_performance",
    "analyze_derivatives",
    "get_capabilities",
)
_EXPENSIVE_CAPABILITY_TOOLS = frozenset(
    {"analyze_derivatives", "analyze_sector_rotation", "get_historical_performance"}
)


async def get_capabilities(deps: ServiceDeps | None = None) -> EvidenceEnvelope[CapabilitiesData]:
    """Report the active profile and tool modes without calling CoinMarketCap."""
    bound = _bound(deps)
    from app.services.budget import get_budget_controller

    snap = await get_budget_controller().snapshot()
    tools: list[ToolAvailability] = []
    for name in _CAPABILITY_TOOLS:
        if name == "get_capabilities":
            tools.append(ToolAvailability(name=name, mode="full"))
            continue
        if snap.ledger_status != "ok" or snap.state == "CUTOFF":
            tools.append(
                ToolAvailability(
                    name=name,
                    mode="fallback",
                    reason="Server-key budget is cutoff or the credit ledger is unavailable.",
                )
            )
        elif snap.state == "EMERGENCY":
            tools.append(
                ToolAvailability(
                    name=name,
                    mode="fallback",
                    reason="Emergency budget keeps live misses on the core warmer only.",
                )
            )
        elif snap.state == "CONSERVATION" and name in _EXPENSIVE_CAPABILITY_TOOLS:
            tools.append(
                ToolAvailability(
                    name=name,
                    mode="fallback",
                    reason="Conservation budget keeps this tool on warm cache or a snapshot.",
                )
            )
        elif name == "get_historical_performance" and not _capability_allows(bound, OHLCV, None):
            tools.append(
                ToolAvailability(
                    name=name,
                    mode="fallback",
                    reason=(
                        "Historical OHLCV is unavailable on the active CoinMarketCap plan "
                        "without caller BYOK."
                    ),
                )
            )
        else:
            tools.append(ToolAvailability(name=name, mode="full"))
    data_mode = "VERIFIED_SNAPSHOT_FALLBACK" if snap.state == "CUTOFF" else "CACHED"
    data = CapabilitiesData(
        quota_profile=snap.quota_profile,
        budget_state=snap.state,
        utilization_pct=snap.utilization_pct,
        ledger_status=snap.ledger_status,
        data_mode=data_mode,
        tools=tools,
    )
    evidence_id = new_evidence_id()
    limitations = [
        "This response reads the in-process budget snapshot and does not call CoinMarketCap."
    ]
    try:
        await bound.evidence.persist(
            EvidenceDraft(
                evidence_id=evidence_id,
                tool_name="get_capabilities",
                asset_cmc_ids=[],
                endpoints_called=[],
                data_mode=data_mode,
                freshness="AGING",
                credit_cost=0,
                engine_version=get_settings().engine_version,
                methodology={
                    "metrics": ["budget_state", "tool_mode"],
                    "observation_window": "current",
                    "annualization_basis": "365d",
                },
                limitations=limitations,
                raw_excerpt={},
            )
        )
    except Exception as exc:
        limitations.append(f"Evidence record could not be stored ({exc.__class__.__name__}).")
    return EvidenceEnvelope(
        tool="get_capabilities",
        engine_version=get_settings().engine_version,
        status=EvidenceStatus.OK,
        summary="Capability and budget mode without a CoinMarketCap call.",
        data=data,
        methodology=MethodologyMeta(
            metrics=["budget_state", "tool_mode"],
            observation_window="current",
            annualization_basis="365d",
        ),
        evidence=EvidenceMeta(
            evidence_id=evidence_id,
            data_mode=data_mode,  # type: ignore[arg-type]
            freshness="AGING",
            retrieved_at_utc=bound.now(),
            source_timestamps={},
            cmc_endpoints_called=[],
            cmc_credit_cost=0,
            cache_hit=True,
        ),
        limitations=limitations,
        agent_actions=[
            AgentAction(
                reason="Use a snapshot-backed overview when a tool is in fallback mode.",
                suggested_tool="get_market_overview",
            )
        ],
    )


def _status(collector: Collector, required_present: bool) -> EvidenceStatus:
    if any(record.error for record in collector.records):
        return EvidenceStatus.PARTIAL if required_present else EvidenceStatus.INSUFFICIENT_DATA
    return EvidenceStatus.OK if required_present else EvidenceStatus.INSUFFICIENT_DATA


async def _envelope(
    tool: str,
    status: EvidenceStatus,
    summary: str,
    data: object,
    metrics: list[str],
    window: str,
    asset_ids: list[int],
    collector: Collector,
    deps: ServiceDeps,
    notes: list[str] | None = None,
) -> EvidenceEnvelope:
    summary_calls = summarize_calls(collector.records, deps.now())
    limitations = dedupe_limitations([*summary_calls.limitations, *(notes or [])])
    evidence_id = new_evidence_id()
    methodology = {
        "metrics": metrics,
        "observation_window": window,
        "annualization_basis": "365d",
    }
    draft = EvidenceDraft(
        evidence_id=evidence_id,
        tool_name=tool,
        asset_cmc_ids=asset_ids,
        endpoints_called=summary_calls.endpoints,
        data_mode=summary_calls.data_mode,
        freshness=summary_calls.freshness,
        credit_cost=summary_calls.credit_cost,
        engine_version=get_settings().engine_version,
        methodology=methodology,
        limitations=limitations,
        raw_excerpt=raw_excerpt(collector.records),
    )
    try:
        await deps.evidence.persist(draft)
    except Exception as exc:
        limitations = dedupe_limitations(
            [*limitations, f"Evidence record could not be stored ({exc.__class__.__name__})."]
        )
    return EvidenceEnvelope(
        tool=tool,
        engine_version=get_settings().engine_version,
        status=status,
        summary=summary,
        data=data,
        methodology=MethodologyMeta(
            metrics=metrics,
            observation_window=window,
            annualization_basis="365d",
        ),
        evidence=EvidenceMeta(
            evidence_id=evidence_id,
            data_mode=summary_calls.data_mode,  # type: ignore[arg-type]
            freshness=summary_calls.freshness,  # type: ignore[arg-type]
            retrieved_at_utc=summary_calls.retrieved_at,
            source_timestamps=summary_calls.source_timestamps,
            cmc_endpoints_called=summary_calls.endpoints,
            cmc_credit_cost=summary_calls.credit_cost,
            cache_hit=summary_calls.cache_hit,
        ),
        limitations=limitations,
    )
