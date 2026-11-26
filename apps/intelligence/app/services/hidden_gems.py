"""Hidden Gem Discovery Engine orchestration service (REST worker & queries)."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Any
from uuid import uuid4

from app.adapters.cache import parse_timestamp
from app.adapters.cmc_client import CMCEndpointUnavailableError, FetchMeta
from app.adapters.normalizer import (
    as_float,
    keyed_assets,
    listing_rows,
    parse_derivatives_pairs,
    parse_ohlcv_bars,
    parse_v3_quotes_historical,
    quote_of,
)
from app.core.config import get_settings
from app.quant.hidden_gems import (
    HIDDEN_GEM_SCORE_VERSION,
    CapabilityProfile,
    DiscoveryTrack,
    FilterPreset,
    HistoricalIndicators,
    MarketRegimeType,
    OhlcvBar,
    ScoredCandidate,
    SnapshotInput,
    TradingHorizon,
    build_benchmark_distribution,
    build_deterministic_explanation,
    compute_historical_indicators,
    derive_return_4h,
    evaluate_hard_gates,
    geometric_rs,
    score_candidate,
)
from app.schemas.hidden_gems import (
    AlertEventItem,
    CandidateDetail,
    CandidateSummary,
    CreateScanRequest,
    EvidenceRecordItem,
    QualityStatsRow,
    RejectionSummary,
    ScanAcceptedResponse,
    ScanConfigCreate,
    ScanConfigItem,
    ScanConfigUpdate,
    ScanRunSummary,
    ScoreHistoryItem,
    WatchlistAddRequest,
    WatchlistItem,
)
from app.services.budget import BudgetController, get_budget_controller
from app.services.hidden_gem_store import (
    HiddenGemStore,
    MemoryHiddenGemStore,
    SupabaseHiddenGemStore,
)
from app.services.intelligence import ServiceDeps, _bound, analyze_market_regime
from app.services.telegram import TelegramNotifier, get_telegram_notifier
from app.services.tier_detection import TierDetector, get_tier_detector

logger = logging.getLogger("cointrac.hidden_gems")

LISTINGS_ENDPOINT = "/v1/cryptocurrency/listings/latest"
QUOTES_ENDPOINT = "/v2/cryptocurrency/quotes/latest"
INFO_ENDPOINT = "/v2/cryptocurrency/info"
OHLCV_ENDPOINT = "/v2/cryptocurrency/ohlcv/historical"
V3_QUOTES_HIST_ENDPOINT = "/v3/cryptocurrency/quotes/historical"
DERIVATIVES_ENDPOINT = "/v5/cryptocurrency/derivatives/market-pairs/list/latest"

_INGEST_LOCK = asyncio.Lock()
_REGIME_LOCK = asyncio.Lock()
_REGIME_CACHE: dict[tuple[int, bool], tuple[datetime, MarketRegimeType]] = {}
_DEFAULT_STORE: HiddenGemStore | None = None
_INSTALLED_STORE: HiddenGemStore | None = None
_BACKGROUND_TASKS: set[asyncio.Task[None]] = set()

_STALE_HEARTBEAT_SECONDS = 300
_HISTORICAL_DAILY_CACHE_TTL = 14400
_HISTORICAL_1H_CACHE_TTL = 3600
_METADATA_MAX_AGE_DAYS = 14


def get_hidden_gem_store() -> HiddenGemStore:
    global _DEFAULT_STORE
    if _INSTALLED_STORE is not None:
        return _INSTALLED_STORE
    if _DEFAULT_STORE is None:
        settings = get_settings()
        _DEFAULT_STORE = (
            SupabaseHiddenGemStore() if settings.supabase_url else MemoryHiddenGemStore()
        )
    return _DEFAULT_STORE


def install_hidden_gem_store(store: HiddenGemStore | None) -> None:
    global _INSTALLED_STORE
    _INSTALLED_STORE = store


def reset_hidden_gem_store() -> None:
    global _DEFAULT_STORE, _INSTALLED_STORE
    _DEFAULT_STORE = None
    _INSTALLED_STORE = None
    _REGIME_CACHE.clear()


@dataclass
class _IngestItem:
    asset_id: str
    snapshot_id: str
    cmc_id: str
    symbol: str
    name: str
    identity_status: str
    tags: tuple[str, ...]
    date_added: datetime | None
    metadata_fetched_at: datetime | None
    num_market_pairs: int | None
    source_timestamp: datetime
    price: float | None
    market_cap: float | None
    volume_24h: float | None
    return_1h: float | None
    return_4h: float | None
    return_24h: float | None
    return_7d: float | None
    return_30d: float | None
    return_60d: float | None
    return_90d: float | None
    rs_btc_7d: float | None
    rs_btc_30d: float | None
    rs_eth_7d: float | None

    def to_snapshot_input(
        self,
        *,
        open_interest: float | None = None,
        funding_rate_8h: float | None = None,
    ) -> SnapshotInput:
        return SnapshotInput(
            canonical_provider_id=self.cmc_id,
            symbol=self.symbol,
            name=self.name,
            identity_status=self.identity_status,
            tags=self.tags,
            source_timestamp=self.source_timestamp,
            price=self.price,
            market_cap=self.market_cap,
            volume_24h=self.volume_24h,
            return_1h=self.return_1h,
            return_4h=self.return_4h,
            return_24h=self.return_24h,
            return_7d=self.return_7d,
            return_30d=self.return_30d,
            return_60d=self.return_60d,
            return_90d=self.return_90d,
            rs_btc_7d=self.rs_btc_7d,
            rs_btc_30d=self.rs_btc_30d,
            rs_eth_7d=self.rs_eth_7d,
            date_added=self.date_added,
            num_market_pairs=self.num_market_pairs,
            open_interest=open_interest,
            funding_rate_8h=funding_rate_8h,
        )


@dataclass
class _IngestBatch:
    batch_id: str
    items: list[_IngestItem]
    btc_price: float | None
    data_mode: str
    reused_cache: bool
    credits_spent: int
    limitations: list[str]


def _resolve_tracks(value: str) -> list[DiscoveryTrack]:
    if value == "EARLY":
        return ["EARLY"]
    if value == "CONFIRMED":
        return ["CONFIRMED"]
    return ["EARLY", "CONFIRMED"]


def _resolve_horizons(value: str) -> list[TradingHorizon]:
    if value == "SHORT_TERM":
        return ["SHORT_TERM"]
    if value == "SWING":
        return ["SWING"]
    return ["SHORT_TERM", "SWING"]


def _build_filter_preset(
    req: CreateScanRequest, config: dict[str, object] | None
) -> FilterPreset:
    defaults = FilterPreset()
    cfg_filters = config.get("filter_config") if isinstance(config, dict) else {}
    raw: dict[str, Any] = dict(cfg_filters) if isinstance(cfg_filters, dict) else {}
    if req.filters is not None:
        raw.update(req.filters.model_dump(exclude_none=True))
    return FilterPreset(
        min_market_cap_usd=float(raw.get("min_market_cap_usd", defaults.min_market_cap_usd)),
        max_market_cap_usd=float(raw.get("max_market_cap_usd", defaults.max_market_cap_usd)),
        min_volume_24h_usd=float(raw.get("min_volume_24h_usd", defaults.min_volume_24h_usd)),
        min_vol_to_mcap=float(raw.get("min_vol_to_mcap", defaults.min_vol_to_mcap)),
        min_listing_age_days=int(
            raw.get("min_listing_age_days", defaults.min_listing_age_days)
        ),
        max_early_return_24h_pct=float(
            raw.get("max_early_return_24h_pct", defaults.max_early_return_24h_pct)
        ),
        max_early_return_7d_pct=float(
            raw.get("max_early_return_7d_pct", defaults.max_early_return_7d_pct)
        ),
    )


def _alert_dedup_key(user_id: str, asset_id: str, track: str, event_type: str) -> str:
    raw = f"{user_id}:{asset_id}:{track}:{event_type}".encode()
    return hashlib.sha256(raw).hexdigest()


def _tags_from_row(row: dict[str, object]) -> tuple[str, ...]:
    raw = row.get("tags")
    if not isinstance(raw, list):
        return ()
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            out.append(item.strip().lower())
        elif isinstance(item, dict):
            slug = item.get("slug") or item.get("name")
            if isinstance(slug, str) and slug.strip():
                out.append(slug.strip().lower())
    return tuple(dict.fromkeys(out))


class HiddenGemService:
    """Async coordinator for Hidden Gem scans, persistence, watchlists, and alerts."""

    def __init__(
        self,
        *,
        store: HiddenGemStore | None = None,
        deps: ServiceDeps | None = None,
        budget: BudgetController | None = None,
        tier_detector: TierDetector | None = None,
        telegram: TelegramNotifier | None = None,
    ) -> None:
        self._store = store
        self._deps = deps
        self._budget = budget
        self._tier_detector = tier_detector
        self._telegram = telegram

    @property
    def store(self) -> HiddenGemStore:
        return self._store or get_hidden_gem_store()

    @property
    def telegram(self) -> TelegramNotifier:
        return self._telegram or get_telegram_notifier()

    @property
    def deps(self) -> ServiceDeps:
        return _bound(self._deps)

    @property
    def budget(self) -> BudgetController:
        return self._budget or get_budget_controller()

    @property
    def tier_detector(self) -> TierDetector:
        return self._tier_detector or get_tier_detector()

    async def _preflight(
        self,
        override_cmc_key: str | None,
    ) -> tuple[str, CapabilityProfile, dict[str, object], MarketRegimeType]:
        snap = await self.budget.snapshot()
        detected = self.tier_detector.effective_profile()
        has_byok = bool(override_cmc_key and override_cmc_key.strip())
        if has_byok:
            effective_tier = "BYOK"
            eval_profile: CapabilityProfile = "STARTUP_CAPABILITY_PROFILE"
        elif snap.state in ("EMERGENCY", "CUTOFF"):
            effective_tier = "BASIC"
            eval_profile = "BASIC_CAPABILITY_PROFILE"
        elif detected == "startup" and snap.state == "NORMAL":
            effective_tier = "STARTUP"
            eval_profile = "STARTUP_CAPABILITY_PROFILE"
        else:
            effective_tier = "BASIC"
            eval_profile = "BASIC_CAPABILITY_PROFILE"

        budget_meta: dict[str, object] = {
            "budget_state": snap.state,
            "quota_profile": snap.quota_profile,
            "detected_plan": detected,
            "monthly_credits_used": snap.credits_used_this_month,
            "monthly_budget": snap.monthly_budget_credits,
        }

        regime: MarketRegimeType = "UNKNOWN"
        if snap.state != "CUTOFF" or has_byok:
            now_dt = self.deps.now()
            cache_k = (id(self.deps.gateway), has_byok)
            async with _REGIME_LOCK:
                cached_reg = _REGIME_CACHE.get(cache_k)
                if cached_reg is not None and (now_dt - cached_reg[0]).total_seconds() < 300:
                    regime = cached_reg[1]
                else:
                    try:
                        reg_env = await analyze_market_regime(
                            override_cmc_key=override_cmc_key,
                            deps=self.deps,
                        )
                        cand_regime = getattr(reg_env.data, "regime", None)
                        if cand_regime in {
                            "RISK_ON_ALTSEASON",
                            "BTC_LED_EXPANSION",
                            "RANGE_CONSOLIDATION",
                            "RISK_OFF_STRESS",
                            "UNKNOWN",
                        }:
                            regime = cand_regime
                    except Exception as exc:
                        logger.debug(
                            "regime fallback UNKNOWN error=%s", exc.__class__.__name__
                        )
                    _REGIME_CACHE[cache_k] = (now_dt, regime)
        return effective_tier, eval_profile, budget_meta, regime

    def _recommended_limit(
        self,
        req: CreateScanRequest,
        config: dict[str, object] | None,
        effective_tier: str,
        budget_state: str,
    ) -> int:
        if req.universe_limit is not None:
            return req.universe_limit
        if isinstance(config, dict):
            u_cfg = config.get("universe_config")
            if isinstance(u_cfg, dict) and isinstance(u_cfg.get("limit"), int):
                return max(50, min(1000, int(u_cfg["limit"])))
        if budget_state in ("CONSERVATION", "EMERGENCY", "CUTOFF"):
            return 200
        if effective_tier in ("STARTUP", "BYOK"):
            return 1000
        return 400

    async def enqueue_scan(
        self,
        *,
        user_id: str,
        req: CreateScanRequest,
        idempotency_key: str | None = None,
        override_cmc_key: str | None = None,
        run_inline: bool = False,
    ) -> ScanAcceptedResponse:
        if idempotency_key:
            existing = await self.store.get_scan_by_idempotency(user_id, idempotency_key)
            if existing is not None:
                return ScanAcceptedResponse(
                    scan_run_id=str(existing["id"]),
                    status=str(existing["status"]),
                    idempotent_replay=True,
                    effective_tier=str(existing.get("effective_tier") or "BASIC"),
                    evaluation_profile=str(
                        existing.get("evaluation_profile") or "BASIC_CAPABILITY_PROFILE"
                    ),
                    estimated_credits=0,
                )

        config: dict[str, object] | None = None
        if req.config_id:
            configs = await self.store.list_configs(user_id)
            config = next((c for c in configs if str(c.get("id")) == req.config_id), None)
            if config is None:
                raise KeyError("Scan config not found")

        snap = await self.budget.snapshot()
        detected = self.tier_detector.effective_profile()
        has_byok = bool(override_cmc_key and override_cmc_key.strip())
        if has_byok:
            effective_tier = "BYOK"
            eval_profile: CapabilityProfile = "STARTUP_CAPABILITY_PROFILE"
        elif detected == "startup" and snap.state == "NORMAL":
            effective_tier = "STARTUP"
            eval_profile = "STARTUP_CAPABILITY_PROFILE"
        else:
            effective_tier = "BASIC"
            eval_profile = "BASIC_CAPABILITY_PROFILE"

        universe_limit = self._recommended_limit(req, config, effective_tier, snap.state)
        est_credits = 0 if snap.state == "CUTOFF" else (12 if effective_tier == "BASIC" else 40)
        now = self.deps.now()
        run_row = {
            "user_id": user_id,
            "scan_config_id": req.config_id,
            "idempotency_key": idempotency_key,
            "status": "QUEUED",
            "discovery_track": req.track,
            "trading_horizon": req.horizon,
            "effective_tier": effective_tier,
            "evaluation_profile": eval_profile,
            "baseline_mode": "CROSS_SECTIONAL_UNIVERSE",
            "market_regime": "UNKNOWN",
            "universe_requested": universe_limit,
            "universe_scanned": 0,
            "candidates_discovered": 0,
            "candidates_eligible": 0,
            "candidates_rejected": 0,
            "cmc_credits_consumed": 0,
            "source_metadata": {},
            "budget_metadata": {
                "budget_state": snap.state,
                "quota_profile": snap.quota_profile,
            },
            "heartbeat_at": now.isoformat(),
        }
        created = await self.store.create_scan_run(run_row)
        scan_run_id = str(created["id"])

        if run_inline:
            await self.execute_scan_run(
                user_id=user_id,
                scan_run_id=scan_run_id,
                req=req,
                config=config,
                override_cmc_key=override_cmc_key,
            )
            latest = await self.store.get_scan(user_id, scan_run_id)
            status_val = str(latest["status"]) if latest else "COMPLETED"
        else:
            task = asyncio.create_task(
                self.execute_scan_run(
                    user_id=user_id,
                    scan_run_id=scan_run_id,
                    req=req,
                    config=config,
                    override_cmc_key=override_cmc_key,
                )
            )
            _BACKGROUND_TASKS.add(task)
            task.add_done_callback(_BACKGROUND_TASKS.discard)
            status_val = "QUEUED"

        return ScanAcceptedResponse(
            scan_run_id=scan_run_id,
            status=status_val,
            idempotent_replay=False,
            effective_tier=effective_tier,
            evaluation_profile=eval_profile,
            estimated_credits=est_credits,
        )

    async def execute_scan_run(
        self,
        *,
        user_id: str,
        scan_run_id: str,
        req: CreateScanRequest,
        config: dict[str, object] | None = None,
        override_cmc_key: str | None = None,
    ) -> None:
        now = self.deps.now()
        try:
            await self.store.update_scan_run(
                user_id,
                scan_run_id,
                {
                    "status": "RUNNING",
                    "started_at": now.isoformat(),
                    "heartbeat_at": now.isoformat(),
                },
            )
            effective_tier, eval_profile, budget_meta, regime = await self._preflight(
                override_cmc_key
            )
            preset = _build_filter_preset(req, config)
            budget_state = str(budget_meta.get("budget_state") or "NORMAL")
            universe_limit = self._recommended_limit(req, config, effective_tier, budget_state)

            await self.store.update_scan_run(
                user_id,
                scan_run_id,
                {
                    "effective_tier": effective_tier,
                    "evaluation_profile": eval_profile,
                    "market_regime": regime,
                    "budget_metadata": budget_meta,
                    "universe_requested": universe_limit,
                    "heartbeat_at": self.deps.now().isoformat(),
                },
            )

            if await self.store.is_cancel_requested(user_id, scan_run_id):
                await self._mark_cancelled(user_id, scan_run_id, 0)
                return

            ingest = await self._ingest_universe(
                universe_limit=universe_limit,
                effective_tier=effective_tier,
                budget_state=budget_state,
                override_cmc_key=override_cmc_key,
            )
            credits_used = ingest.credits_spent
            limitations = list(ingest.limitations)

            if not ingest.items:
                await self.store.update_scan_run(
                    user_id,
                    scan_run_id,
                    {
                        "status": "FAILED",
                        "error_summary": "; ".join(limitations) or "No market snapshots ingested",
                        "cmc_credits_consumed": credits_used,
                        "completed_at": self.deps.now().isoformat(),
                    },
                )
                return

            if await self.store.is_cancel_requested(user_id, scan_run_id):
                await self._mark_cancelled(user_id, scan_run_id, credits_used)
                return

            tracks = _resolve_tracks(req.track)
            horizons = _resolve_horizons(req.horizon)

            base_snaps = [item.to_snapshot_input() for item in ingest.items]
            benchmark = build_benchmark_distribution(base_snaps)

            item_by_cid = {item.cmc_id: item for item in ingest.items}
            finalist_items: dict[str, _IngestItem] = {}
            rejections: list[dict[str, object]] = []
            seen_reject_keys: set[tuple[str, str]] = set()

            for item in ingest.items:
                snap_in = item.to_snapshot_input()
                for track in tracks:
                    reasons, _partial_age = evaluate_hard_gates(
                        snap_in,
                        now=now,
                        track=track,
                        preset=preset,
                    )
                    if not reasons:
                        finalist_items[item.cmc_id] = item
                    else:
                        first = reasons[0]
                        rk = (item.asset_id, f"{track}:{first.code}")
                        if rk not in seen_reject_keys:
                            seen_reject_keys.add(rk)
                            rejections.append(
                                {
                                    "scan_run_id": scan_run_id,
                                    "asset_id": item.asset_id,
                                    "rejection_stage": first.stage,
                                    "rejection_code": first.code,
                                    "rejection_reason": first.reason,
                                    "observed_metrics": first.observed_metrics,
                                }
                            )

            await self.store.update_scan_run(
                user_id,
                scan_run_id,
                {
                    "universe_scanned": len(ingest.items),
                    "heartbeat_at": self.deps.now().isoformat(),
                },
            )

            # Stage 4: Metadata enrichment for finalists missing date_added or stale metadata
            finalist_list = list(finalist_items.values())
            finalist_list.sort(
                key=lambda it: (it.rs_btc_7d if it.rs_btc_7d is not None else -999.0),
                reverse=True,
            )
            if budget_state not in ("EMERGENCY", "CUTOFF") or override_cmc_key:
                meta_credits = await self._enrich_metadata(
                    finalist_list[:40],
                    now=now,
                    override_cmc_key=override_cmc_key,
                )
                credits_used += meta_credits
                # Re-verify min_listing_age_days after date_added backfill
                filtered_finalists: list[_IngestItem] = []
                for item in finalist_list:
                    still_ok = True
                    if item.date_added is not None and preset.min_listing_age_days > 0:
                        age_days = (now - item.date_added).total_seconds() / 86400.0
                        if age_days < preset.min_listing_age_days:
                            still_ok = False
                            rejections.append(
                                {
                                    "scan_run_id": scan_run_id,
                                    "asset_id": item.asset_id,
                                    "rejection_stage": "HARD_GATE",
                                    "rejection_code": "MIN_LISTING_AGE",
                                    "rejection_reason": (
                                        f"Listing age {age_days:.1f}d < "
                                        f"{preset.min_listing_age_days}d after metadata backfill"
                                    ),
                                    "observed_metrics": {"listing_age_days": round(age_days, 2)},
                                }
                            )
                    if still_ok:
                        filtered_finalists.append(item)
                finalist_list = filtered_finalists

            if await self.store.is_cancel_requested(user_id, scan_run_id):
                await self._mark_cancelled(user_id, scan_run_id, credits_used)
                return

            # Stage 5: Historical & selective derivatives enrichment
            hist_cap = 50 if eval_profile == "STARTUP_CAPABILITY_PROFILE" else 30
            hist_targets = finalist_list[:hist_cap]
            (
                indicators_by_cid,
                derivs_by_cid,
                effective_eval_profile,
                stage5_credits,
                stage5_notes,
            ) = await self._enrich_historical_and_derivatives(
                user_id=user_id,
                scan_run_id=scan_run_id,
                finalists=hist_targets,
                tracks=tracks,
                horizons=horizons,
                eval_profile=eval_profile,
                budget_state=budget_state,
                override_cmc_key=override_cmc_key,
                now=now,
            )
            credits_used += stage5_credits
            limitations.extend(stage5_notes)

            if await self.store.is_cancel_requested(user_id, scan_run_id):
                await self._mark_cancelled(user_id, scan_run_id, credits_used)
                return

            # Stage 6-8: Score candidates, deltas, alerts, outcome checkpoints
            scored_list: list[tuple[_IngestItem, ScoredCandidate]] = []
            candidate_rows: list[dict[str, object]] = []
            evidence_by_key: dict[tuple[str, str, str], list[dict[str, object]]] = {}
            history_rows: list[dict[str, object]] = []
            checkpoints: list[dict[str, object]] = []
            alerts: list[dict[str, object]] = []

            for item in finalist_list:
                oi, fr = derivs_by_cid.get(item.cmc_id, (None, None))
                snap_in = item.to_snapshot_input(open_interest=oi, funding_rate_8h=fr)
                hist_ind = indicators_by_cid.get(item.cmc_id)

                for track in tracks:
                    for horizon in horizons:
                        scored = score_candidate(
                            snap_in,
                            benchmark,
                            now=now,
                            track=track,
                            horizon=horizon,
                            profile=effective_eval_profile,
                            regime=regime,
                            preset=preset,
                            historical=hist_ind,
                        )
                        scored_list.append((item, scored))
                        key = (item.asset_id, track, horizon)
                        comp_dict = {
                            name: {
                                "score": comp.score,
                                "base_weight": comp.base_weight,
                                "effective_weight": comp.effective_weight,
                                "quality_status": comp.quality_status,
                            }
                            for name, comp in scored.components.items()
                        }
                        weights_dict = {
                            name: comp.effective_weight
                            for name, comp in scored.components.items()
                        }
                        penalties_list = [
                            {"code": p.code, "points": p.points, "reason": p.reason}
                            for p in scored.penalties
                        ]
                        rej_list = [
                            {
                                "stage": r.stage,
                                "code": r.code,
                                "reason": r.reason,
                                "observed_metrics": r.observed_metrics,
                            }
                            for r in scored.rejection_reasons
                        ]
                        candidate_rows.append(
                            {
                                "scan_run_id": scan_run_id,
                                "asset_id": item.asset_id,
                                "market_snapshot_id": item.snapshot_id,
                                "discovery_track": track,
                                "trading_horizon": horizon,
                                "raw_score": scored.raw_score,
                                "adjusted_score": scored.adjusted_score,
                                "valid_weight_coverage": scored.valid_weight_coverage,
                                "confidence_level": scored.confidence_level,
                                "data_confidence": scored.data_confidence,
                                "signal_confidence": scored.signal_confidence,
                                "liquidity_confidence": scored.liquidity_confidence,
                                "liquidity_mode": scored.liquidity_mode,
                                "classification": scored.classification,
                                "eligibility_status": scored.eligibility_status,
                                "score_version": scored.score_version,
                                "component_scores": comp_dict,
                                "effective_weights": weights_dict,
                                "penalties": penalties_list,
                                "missing_components": list(scored.missing_components),
                                "rejection_reasons": rej_list,
                                "badges": list(scored.badges),
                                "explanation": None,
                            }
                        )
                        evidence_by_key[key] = [
                            {
                                "evidence_type": obs.evidence_type,
                                "metric_name": obs.metric_name,
                                "observed_value": obs.observed_value,
                                "interpretation": obs.interpretation,
                                "direction": obs.direction,
                                "source_provider": "coinmarketcap",
                                "source_endpoint": obs.source_endpoint,
                                "source_timestamp": item.source_timestamp.isoformat(),
                                "fetched_at": now.isoformat(),
                                "quality_status": obs.quality_status,
                                "metadata": obs.metadata,
                            }
                            for obs in scored.observations
                        ]

                        prev = await self.store.get_previous_candidate(
                            user_id, item.asset_id, track, horizon, scan_run_id
                        )
                        prev_score = as_float(prev.get("adjusted_score")) if prev else None
                        prev_status = str(prev.get("eligibility_status")) if prev else None
                        delta = (
                            round(scored.adjusted_score - prev_score, 4)
                            if (scored.adjusted_score is not None and prev_score is not None)
                            else None
                        )
                        history_rows.append(
                            {
                                "asset_id": item.asset_id,
                                "discovery_track": track,
                                "trading_horizon": horizon,
                                "previous_score": prev_score,
                                "current_score": scored.adjusted_score,
                                "score_delta": delta,
                                "previous_status": prev_status,
                                "current_status": scored.eligibility_status,
                            }
                        )

                        # Outcome checkpoint for ELIGIBLE candidates with valid prices
                        if (
                            scored.eligibility_status == "ELIGIBLE"
                            and item.price is not None
                            and item.price > 0
                            and ingest.btc_price is not None
                            and ingest.btc_price > 0
                        ):
                            checkpoints.append(
                                {
                                    "user_id": user_id,
                                    "asset_id": item.asset_id,
                                    "discovery_track": track,
                                    "trading_horizon": horizon,
                                    "score_version": HIDDEN_GEM_SCORE_VERSION,
                                    "entry_price": item.price,
                                    "entry_btc_price": ingest.btc_price,
                                    "entry_observed_at": item.source_timestamp.isoformat(),
                                }
                            )

                        # Alert generation with 6h SHA-256 deduplication
                        cand_alerts = await self._build_alerts(
                            user_id=user_id,
                            item=item,
                            scored=scored,
                            prev=prev,
                            delta=delta,
                            now=now,
                        )
                        alerts.extend(cand_alerts)

            # Top 5 eligible/watchlisted >= 70 receive eager deterministic explanations
            explain_candidates = [
                (item, sc)
                for item, sc in scored_list
                if sc.adjusted_score is not None and sc.adjusted_score >= 70.0
            ]
            explain_candidates.sort(
                key=lambda pair: pair[1].adjusted_score or 0.0,
                reverse=True,
            )
            explain_keys: set[tuple[str, str, str]] = {
                (item.asset_id, sc.discovery_track, sc.trading_horizon)
                for item, sc in explain_candidates[:5]
            }
            scored_lookup: dict[tuple[str, str, str], ScoredCandidate] = {
                (item.asset_id, sc.discovery_track, sc.trading_horizon): sc
                for item, sc in scored_list
            }

            def _explain(
                cand_row: dict[str, object],
                persisted_ev: list[dict[str, object]],
            ) -> dict[str, object]:
                k = (
                    str(cand_row["asset_id"]),
                    str(cand_row["discovery_track"]),
                    str(cand_row["trading_horizon"]),
                )
                sc_obj = scored_lookup[k]
                return build_deterministic_explanation(sc_obj, persisted_ev)

            partial_reason: str | None = None
            try:
                await self.store.persist_scan_outputs(
                    user_id=user_id,
                    scan_run_id=scan_run_id,
                    candidates=candidate_rows,
                    evidence_by_key=evidence_by_key,
                    rejections=rejections,
                    history_rows=history_rows,
                    checkpoints=checkpoints,
                    alerts=alerts,
                    explanation_builder=_explain,
                    explain_keys=explain_keys,
                )
                if alerts:
                    await self._dispatch_telegram_alerts(
                        user_id=user_id,
                        scan_run_id=scan_run_id,
                        config=config,
                    )
            except Exception as exc:
                logger.warning(
                    "persist_scan_outputs failed scan_run_id=%s err=%s",
                    scan_run_id,
                    exc.__class__.__name__,
                )
                partial_reason = f"Partial persistence failure: {exc.__class__.__name__}"

            eligible_count = sum(
                1 for _, sc in scored_list if sc.eligibility_status == "ELIGIBLE"
            )
            final_status = "COMPLETED"
            if partial_reason or effective_eval_profile != eval_profile:
                final_status = "PARTIAL"
            del item_by_cid

            await self.store.update_scan_run(
                user_id,
                scan_run_id,
                {
                    "status": final_status,
                    "evaluation_profile": effective_eval_profile,
                    "universe_scanned": len(ingest.items),
                    "candidates_discovered": len(candidate_rows),
                    "candidates_eligible": eligible_count,
                    "candidates_rejected": len(rejections),
                    "cmc_credits_consumed": credits_used,
                    "source_metadata": {
                        "batch_id": ingest.batch_id,
                        "data_mode": ingest.data_mode,
                        "reused_cache": ingest.reused_cache,
                        "limitations": list(dict.fromkeys(limitations)),
                    },
                    "error_summary": partial_reason,
                    "heartbeat_at": self.deps.now().isoformat(),
                    "completed_at": self.deps.now().isoformat(),
                },
            )
        except Exception as exc:
            logger.exception("Hidden gem scan execution crashed scan_run_id=%s", scan_run_id)
            await self.store.update_scan_run(
                user_id,
                scan_run_id,
                {
                    "status": "FAILED",
                    "error_summary": f"{exc.__class__.__name__}: {exc}",
                    "completed_at": self.deps.now().isoformat(),
                },
            )

    async def _mark_cancelled(self, user_id: str, scan_run_id: str, credits: int) -> None:
        await self.store.update_scan_run(
            user_id,
            scan_run_id,
            {
                "status": "CANCELLED",
                "cmc_credits_consumed": credits,
                "completed_at": self.deps.now().isoformat(),
            },
        )

    async def _build_alerts(
        self,
        *,
        user_id: str,
        item: _IngestItem,
        scored: ScoredCandidate,
        prev: dict[str, object] | None,
        delta: float | None,
        now: datetime,
    ) -> list[dict[str, object]]:
        alerts: list[dict[str, object]] = []
        since = now - timedelta(hours=6)
        score_val = scored.adjusted_score

        events: list[tuple[str, str, dict[str, object]]] = []
        if scored.eligibility_status == "ELIGIBLE" and score_val is not None:
            sev = "HIGH" if score_val >= 80.0 else ("MEDIUM" if score_val >= 70.0 else "INFO")
            events.append(
                (
                    "NEW_DISCOVERY",
                    sev,
                    {
                        "symbol": item.symbol,
                        "adjusted_score": score_val,
                        "track": scored.discovery_track,
                        "horizon": scored.trading_horizon,
                    },
                )
            )
        if prev is not None and scored.confidence_level == "HIGH":
            if str(prev.get("confidence_level") or "") != "HIGH":
                events.append(
                    (
                        "CONFIRMATION",
                        "MEDIUM",
                        {
                            "symbol": item.symbol,
                            "from": prev.get("confidence_level"),
                            "to": "HIGH",
                            "adjusted_score": score_val,
                        },
                    )
                )
        if delta is not None and delta >= 20.0:
            events.append(
                (
                    "SCORE_UPGRADE",
                    "MEDIUM",
                    {"symbol": item.symbol, "score_delta": delta, "adjusted_score": score_val},
                )
            )
        if prev is not None and scored.eligibility_status == "REJECTED":
            if str(prev.get("eligibility_status") or "") == "ELIGIBLE":
                events.append(
                    (
                        "INVALIDATION",
                        "HIGH",
                        {"symbol": item.symbol, "track": scored.discovery_track},
                    )
                )

        for event_type, severity, payload in events:
            dedup_key = _alert_dedup_key(user_id, item.asset_id, scored.discovery_track, event_type)
            if await self.store.has_recent_alert(user_id, dedup_key, since):
                continue
            alerts.append(
                {
                    "asset_id": item.asset_id,
                    "event_type": event_type,
                    "severity": severity,
                    "dedup_key": dedup_key,
                    "payload": payload,
                    "delivery_channel": "IN_APP",
                    "delivery_status": "SENT",
                }
            )
        return alerts

    async def _ingest_universe(
        self,
        *,
        universe_limit: int,
        effective_tier: str,
        budget_state: str,
        override_cmc_key: str | None,
    ) -> _IngestBatch:
        max_age = 86400 if budget_state in ("EMERGENCY", "CUTOFF") else (
            300 if effective_tier in ("STARTUP", "BYOK") else 900
        )
        limitations: list[str] = []

        async with _INGEST_LOCK:
            now = self.deps.now()
            cached_batch = await self.store.get_recent_ingest_batch(max_age, now)
            if cached_batch is not None:
                batch_id, batch_rows = cached_batch
                first_meta = batch_rows[0].get("raw_meta") if batch_rows else {}
                cached_req_limit = (
                    int(first_meta.get("requested_limit") or 0)
                    if isinstance(first_meta, dict)
                    else 0
                )
                can_reuse = (
                    budget_state in ("EMERGENCY", "CUTOFF")
                    or len(batch_rows) >= universe_limit
                    or cached_req_limit >= universe_limit
                )
                if can_reuse:
                    items = [self._item_from_cached_row(row, now) for row in batch_rows]
                    items = [it for it in items if it is not None]
                    btc_price = next((it.price for it in items if it.cmc_id == "1"), None)
                    return _IngestBatch(
                        batch_id=batch_id,
                        items=items,
                        btc_price=btc_price,
                        data_mode="CACHED",
                        reused_cache=True,
                        credits_spent=0,
                        limitations=limitations,
                    )

            if budget_state == "CUTOFF" and not override_cmc_key:
                limitations.append("Budget state CUTOFF and no cached snapshot batch available")
                return _IngestBatch(
                    batch_id=str(uuid4()),
                    items=[],
                    btc_price=None,
                    data_mode="CACHED",
                    reused_cache=False,
                    credits_spent=0,
                    limitations=limitations,
                )

            credits_spent = 0
            try:
                payload, meta = await self.deps.gateway.fetch(  # type: ignore[attr-defined]
                    LISTINGS_ENDPOINT,
                    {"start": 1, "limit": universe_limit, "convert": "USD"},
                    ttl_seconds=max_age,
                    override_api_key=override_cmc_key,
                )
            except Exception as exc:
                limitations.append(f"Listings fetch failed: {exc.__class__.__name__}")
                return _IngestBatch(
                    batch_id=str(uuid4()),
                    items=[],
                    btc_price=None,
                    data_mode="CACHED",
                    reused_cache=False,
                    credits_spent=0,
                    limitations=limitations,
                )

            if isinstance(meta, FetchMeta):
                credits_spent += meta.credit_cost
                data_mode = meta.data_mode
            else:
                data_mode = "LIVE"

            rows = listing_rows(payload)
            if not rows:
                limitations.append("Listings response contained zero rows")
                return _IngestBatch(
                    batch_id=str(uuid4()),
                    items=[],
                    btc_price=None,
                    data_mode=data_mode,
                    reused_cache=False,
                    credits_spent=credits_spent,
                    limitations=limitations,
                )

            batch_id = str(uuid4())
            asset_payloads: list[dict[str, object]] = []
            parsed_rows: list[dict[str, object]] = []
            for row in rows:
                raw_id = row.get("id")
                if not isinstance(raw_id, int) or isinstance(raw_id, bool) or raw_id <= 0:
                    continue
                cid = str(raw_id)
                q = quote_of(row, "USD")
                price = as_float(q.get("price"))
                mcap = as_float(q.get("market_cap"))
                vol = as_float(q.get("volume_24h"))
                vol_to_mcap = (vol / mcap) if (vol is not None and mcap and mcap > 0) else None
                tags = _tags_from_row(row)
                date_added = parse_timestamp(row.get("date_added"))
                src_ts = parse_timestamp(q.get("last_updated")) or now
                asset_payloads.append(
                    {
                        "canonical_provider": "coinmarketcap",
                        "canonical_provider_id": cid,
                        "symbol": str(row.get("symbol") or "").upper(),
                        "name": str(row.get("name") or ""),
                        "slug": row.get("slug"),
                        "identity_status": "VERIFIED",
                        "tags": list(tags),
                        "date_added": date_added.isoformat() if date_added else None,
                        "num_market_pairs": (
                            int(row["num_market_pairs"])
                            if isinstance(row.get("num_market_pairs"), int)
                            else None
                        ),
                    }
                )
                parsed_rows.append(
                    {
                        "cmc_id": cid,
                        "symbol": str(row.get("symbol") or "").upper(),
                        "name": str(row.get("name") or ""),
                        "tags": tags,
                        "date_added": date_added,
                        "num_market_pairs": (
                            int(row["num_market_pairs"])
                            if isinstance(row.get("num_market_pairs"), int)
                            else None
                        ),
                        "source_timestamp": src_ts,
                        "price": price,
                        "market_cap": mcap,
                        "volume_24h": vol,
                        "vol_to_mcap": vol_to_mcap,
                        "return_1h": as_float(q.get("percent_change_1h")),
                        "return_24h": as_float(q.get("percent_change_24h")),
                        "return_7d": as_float(q.get("percent_change_7d")),
                        "return_30d": as_float(q.get("percent_change_30d")),
                        "return_60d": as_float(q.get("percent_change_60d")),
                        "return_90d": as_float(q.get("percent_change_90d")),
                    }
                )

            asset_id_map = await self.store.upsert_assets(asset_payloads)

            # Extract BTC & ETH benchmark returns from same USD batch (or backfill once)
            btc_row = next((r for r in parsed_rows if r["cmc_id"] == "1"), None)
            eth_row = next((r for r in parsed_rows if r["cmc_id"] == "1027"), None)
            if (btc_row is None or eth_row is None) and budget_state != "CUTOFF":
                try:
                    q_payload, q_meta = await self.deps.gateway.fetch(  # type: ignore[attr-defined]
                        QUOTES_ENDPOINT,
                        {"id": "1,1027", "convert": "USD"},
                        ttl_seconds=300,
                        override_api_key=override_cmc_key,
                    )
                    if isinstance(q_meta, FetchMeta):
                        credits_spent += q_meta.credit_cost
                    keyed_rows = keyed_assets(q_payload)
                    keyed = {
                        str(row["id"]): row
                        for row in keyed_rows
                        if row.get("id") is not None
                    }
                    if btc_row is None and "1" in keyed:
                        bq = quote_of(keyed["1"], "USD")
                        btc_row = {
                            "price": as_float(bq.get("price")),
                            "return_7d": as_float(bq.get("percent_change_7d")),
                            "return_30d": as_float(bq.get("percent_change_30d")),
                        }
                    if eth_row is None and "1027" in keyed:
                        eq = quote_of(keyed["1027"], "USD")
                        eth_row = {"return_7d": as_float(eq.get("percent_change_7d"))}
                except Exception:
                    limitations.append("BTC/ETH benchmark quotes unavailable for RS calculation")

            btc_price = as_float(btc_row.get("price")) if btc_row else None
            btc_7d = as_float(btc_row.get("return_7d")) if btc_row else None
            btc_30d = as_float(btc_row.get("return_30d")) if btc_row else None
            eth_7d = as_float(eth_row.get("return_7d")) if eth_row else None

            prior_prices = await self.store.get_prior_snapshot_prices(
                list(asset_id_map.values()),
                now - timedelta(hours=4, minutes=30),
                now - timedelta(hours=3, minutes=30),
            )

            snap_payloads: list[dict[str, object]] = []
            for row in parsed_rows:
                cid = str(row["cmc_id"])
                aid = asset_id_map.get(cid)
                if not aid:
                    continue
                src_ts = row["source_timestamp"]
                assert isinstance(src_ts, datetime)
                price = as_float(row.get("price"))
                ret_4h = derive_return_4h(price, src_ts, prior_prices.get(aid, ()))
                rs_btc_7d = geometric_rs(as_float(row.get("return_7d")), btc_7d)
                rs_btc_30d = geometric_rs(as_float(row.get("return_30d")), btc_30d)
                rs_eth_7d = geometric_rs(as_float(row.get("return_7d")), eth_7d)
                row["asset_id"] = aid
                row["return_4h"] = ret_4h
                row["rs_btc_7d"] = rs_btc_7d
                row["rs_btc_30d"] = rs_btc_30d
                row["rs_eth_7d"] = rs_eth_7d
                snap_payloads.append(
                    {
                        "asset_id": aid,
                        "ingest_batch_id": batch_id,
                        "price": price,
                        "market_cap": row["market_cap"],
                        "volume_24h": row["volume_24h"],
                        "vol_to_mcap": row["vol_to_mcap"],
                        "return_1h": row["return_1h"],
                        "return_4h": ret_4h,
                        "return_24h": row["return_24h"],
                        "return_7d": row["return_7d"],
                        "return_30d": row["return_30d"],
                        "return_60d": row["return_60d"],
                        "return_90d": row["return_90d"],
                        "rs_btc_7d": rs_btc_7d,
                        "rs_btc_30d": rs_btc_30d,
                        "rs_eth_7d": rs_eth_7d,
                        "source_timestamp": src_ts.isoformat(),
                        "observed_at": src_ts.isoformat(),
                        "fetched_at": now.isoformat(),
                        "data_mode": data_mode,
                        "raw_meta": {
                            "endpoint": LISTINGS_ENDPOINT,
                            "requested_limit": universe_limit,
                        },
                    }
                )

            snap_id_map = await self.store.insert_snapshots(snap_payloads)
            items: list[_IngestItem] = []
            for row in parsed_rows:
                aid = str(row.get("asset_id") or "")
                sid = snap_id_map.get(aid)
                if not aid or not sid:
                    continue
                src_ts = row["source_timestamp"]
                assert isinstance(src_ts, datetime)
                date_added = row["date_added"]
                items.append(
                    _IngestItem(
                        asset_id=aid,
                        snapshot_id=sid,
                        cmc_id=str(row["cmc_id"]),
                        symbol=str(row["symbol"]),
                        name=str(row["name"]),
                        identity_status="VERIFIED",
                        tags=row["tags"] if isinstance(row["tags"], tuple) else (),
                        date_added=date_added if isinstance(date_added, datetime) else None,
                        metadata_fetched_at=None,
                        num_market_pairs=(
                            int(row["num_market_pairs"])
                            if isinstance(row.get("num_market_pairs"), int)
                            else None
                        ),
                        source_timestamp=src_ts,
                        price=as_float(row.get("price")),
                        market_cap=as_float(row.get("market_cap")),
                        volume_24h=as_float(row.get("volume_24h")),
                        return_1h=as_float(row.get("return_1h")),
                        return_4h=as_float(row.get("return_4h")),
                        return_24h=as_float(row.get("return_24h")),
                        return_7d=as_float(row.get("return_7d")),
                        return_30d=as_float(row.get("return_30d")),
                        return_60d=as_float(row.get("return_60d")),
                        return_90d=as_float(row.get("return_90d")),
                        rs_btc_7d=as_float(row.get("rs_btc_7d")),
                        rs_btc_30d=as_float(row.get("rs_btc_30d")),
                        rs_eth_7d=as_float(row.get("rs_eth_7d")),
                    )
                )
            return _IngestBatch(
                batch_id=batch_id,
                items=items,
                btc_price=btc_price,
                data_mode=data_mode,
                reused_cache=False,
                credits_spent=credits_spent,
                limitations=limitations,
            )

    @staticmethod
    def _item_from_cached_row(row: dict[str, object], fallback_ts: datetime) -> _IngestItem | None:
        asset = row.get("asset") if isinstance(row.get("asset"), dict) else {}
        aid = str(row.get("asset_id") or "")
        sid = str(row.get("id") or "")
        cid = str(asset.get("canonical_provider_id") or "")
        if not aid or not sid or not cid:
            return None
        tags_raw = asset.get("tags")
        tags = tuple(str(t).lower() for t in tags_raw) if isinstance(tags_raw, list) else ()
        src_ts = parse_timestamp(row.get("source_timestamp")) or fallback_ts
        return _IngestItem(
            asset_id=aid,
            snapshot_id=sid,
            cmc_id=cid,
            symbol=str(asset.get("symbol") or ""),
            name=str(asset.get("name") or ""),
            identity_status=str(asset.get("identity_status") or "VERIFIED"),
            tags=tags,
            date_added=parse_timestamp(asset.get("date_added")),
            metadata_fetched_at=parse_timestamp(asset.get("metadata_fetched_at")),
            num_market_pairs=(
                int(asset["num_market_pairs"])
                if isinstance(asset.get("num_market_pairs"), int)
                else None
            ),
            source_timestamp=src_ts,
            price=as_float(row.get("price")),
            market_cap=as_float(row.get("market_cap")),
            volume_24h=as_float(row.get("volume_24h")),
            return_1h=as_float(row.get("return_1h")),
            return_4h=as_float(row.get("return_4h")),
            return_24h=as_float(row.get("return_24h")),
            return_7d=as_float(row.get("return_7d")),
            return_30d=as_float(row.get("return_30d")),
            return_60d=as_float(row.get("return_60d")),
            return_90d=as_float(row.get("return_90d")),
            rs_btc_7d=as_float(row.get("rs_btc_7d")),
            rs_btc_30d=as_float(row.get("rs_btc_30d")),
            rs_eth_7d=as_float(row.get("rs_eth_7d")),
        )

    async def _enrich_metadata(
        self,
        finalists: list[_IngestItem],
        *,
        now: datetime,
        override_cmc_key: str | None,
    ) -> int:
        stale_cutoff = now - timedelta(days=_METADATA_MAX_AGE_DAYS)
        needing: list[_IngestItem] = []
        for item in finalists:
            if item.date_added is None or item.metadata_fetched_at is None:
                needing.append(item)
            elif item.metadata_fetched_at < stale_cutoff:
                needing.append(item)
        if not needing:
            return 0

        credits = 0
        for idx in range(0, len(needing), 50):
            chunk = needing[idx : idx + 50]
            ids_param = ",".join(it.cmc_id for it in chunk)
            try:
                payload, meta = await self.deps.gateway.fetch(  # type: ignore[attr-defined]
                    INFO_ENDPOINT,
                    {"id": ids_param},
                    ttl_seconds=_METADATA_MAX_AGE_DAYS * 86400,
                    override_api_key=override_cmc_key,
                )
            except Exception as exc:
                logger.debug("Stage 4 metadata info failed err=%s", exc.__class__.__name__)
                continue
            if isinstance(meta, FetchMeta):
                credits += meta.credit_cost
            info_rows = keyed_assets(payload)
            info_map = {
                str(row["id"]): row
                for row in info_rows
                if row.get("id") is not None
            }
            updates: list[dict[str, object]] = []
            for item in chunk:
                info = info_map.get(item.cmc_id)
                if not info:
                    continue
                parsed_date = parse_timestamp(info.get("date_added"))
                if parsed_date is not None:
                    item.date_added = parsed_date
                item.metadata_fetched_at = now
                new_tags = _tags_from_row(info)
                if new_tags:
                    item.tags = new_tags
                updates.append(
                    {
                        "canonical_provider": "coinmarketcap",
                        "canonical_provider_id": item.cmc_id,
                        "symbol": item.symbol,
                        "name": item.name,
                        "category": info.get("category"),
                        "tags": list(item.tags),
                        "date_added": (
                            item.date_added.isoformat() if item.date_added else None
                        ),
                        "urls": info.get("urls") if isinstance(info.get("urls"), dict) else {},
                        "metadata_fetched_at": now.isoformat(),
                    }
                )
            if updates:
                await self.store.upsert_assets(updates)
        return credits

    async def _enrich_historical_and_derivatives(
        self,
        *,
        user_id: str,
        scan_run_id: str,
        finalists: list[_IngestItem],
        tracks: Sequence[DiscoveryTrack],
        horizons: Sequence[TradingHorizon],
        eval_profile: CapabilityProfile,
        budget_state: str,
        override_cmc_key: str | None,
        now: datetime,
    ) -> tuple[
        dict[str, HistoricalIndicators],
        dict[str, tuple[float | None, float | None]],
        CapabilityProfile,
        int,
        list[str],
    ]:
        effective_profile = eval_profile
        need_4h = "SHORT_TERM" in horizons
        sem = asyncio.Semaphore(10 if eval_profile == "STARTUP_CAPABILITY_PROFILE" else 3)
        indicators: dict[str, HistoricalIndicators] = {}
        derivs: dict[str, tuple[float | None, float | None]] = {}
        notes: list[str] = []
        total_credits = 0
        lock = asyncio.Lock()

        async def _process_one(item: _IngestItem) -> None:
            nonlocal effective_profile, total_credits
            if await self.store.is_cancel_requested(user_id, scan_run_id):
                return
            async with sem:
                daily_bars = await self.store.get_cached_historical(
                    item.asset_id, "DAILY", _HISTORICAL_DAILY_CACHE_TTL, now
                )
                bars_1h: list[OhlcvBar] = []
                if need_4h:
                    bars_1h = await self.store.get_cached_historical(
                        item.asset_id, "1H", _HISTORICAL_1H_CACHE_TTL, now
                    )

                if (
                    not daily_bars
                    and effective_profile == "STARTUP_CAPABILITY_PROFILE"
                    and (budget_state != "CUTOFF" or override_cmc_key)
                ):
                    try:
                        payload, meta = await self.deps.gateway.fetch(  # type: ignore[attr-defined]
                            OHLCV_ENDPOINT,
                            {"id": item.cmc_id, "count": 210, "interval": "1d", "convert": "USD"},
                            ttl_seconds=_HISTORICAL_DAILY_CACHE_TTL,
                            override_api_key=override_cmc_key,
                        )
                        if isinstance(meta, FetchMeta):
                            async with lock:
                                total_credits += meta.credit_cost
                        parsed = parse_ohlcv_bars(payload, "USD").get(int(item.cmc_id), [])
                        if parsed:
                            await self.store.upsert_historical_cache(
                                item.asset_id,
                                "DAILY",
                                [
                                    {
                                        "bar_timestamp": b["timestamp"],
                                        "open": b["open"],
                                        "high": b["high"],
                                        "low": b["low"],
                                        "close": b["close"],
                                        "volume": b["volume"],
                                        "source_endpoint": OHLCV_ENDPOINT,
                                    }
                                    for b in parsed
                                ],
                            )
                            daily_bars = [
                                OhlcvBar(
                                    timestamp=b["timestamp"],  # type: ignore[arg-type]
                                    open=as_float(b["open"]),
                                    high=as_float(b["high"]),
                                    low=as_float(b["low"]),
                                    close=float(b["close"]),  # type: ignore[arg-type]
                                    volume=as_float(b["volume"]),
                                )
                                for b in parsed
                            ]
                    except CMCEndpointUnavailableError as exc:
                        if exc.category == "tier_restricted":
                            async with lock:
                                effective_profile = "BASIC_CAPABILITY_PROFILE"
                                notes.append(
                                    "OHLCV tier restricted (403); fell back to BASIC capability"
                                )
                    except Exception as exc:
                        logger.debug("OHLCV daily failed cid=%s err=%s", item.cmc_id, exc)

                if (
                    need_4h
                    and not bars_1h
                    and effective_profile == "STARTUP_CAPABILITY_PROFILE"
                    and (budget_state != "CUTOFF" or override_cmc_key)
                ):
                    try:
                        p1h, m1h = await self.deps.gateway.fetch(  # type: ignore[attr-defined]
                            OHLCV_ENDPOINT,
                            {"id": item.cmc_id, "count": 168, "interval": "1h", "convert": "USD"},
                            ttl_seconds=_HISTORICAL_1H_CACHE_TTL,
                            override_api_key=override_cmc_key,
                        )
                        if isinstance(m1h, FetchMeta):
                            async with lock:
                                total_credits += m1h.credit_cost
                        parsed_1h = parse_ohlcv_bars(p1h, "USD").get(int(item.cmc_id), [])
                        if parsed_1h:
                            await self.store.upsert_historical_cache(
                                item.asset_id,
                                "1H",
                                [
                                    {
                                        "bar_timestamp": b["timestamp"],
                                        "open": b["open"],
                                        "high": b["high"],
                                        "low": b["low"],
                                        "close": b["close"],
                                        "volume": b["volume"],
                                        "source_endpoint": OHLCV_ENDPOINT,
                                    }
                                    for b in parsed_1h
                                ],
                            )
                            bars_1h = [
                                OhlcvBar(
                                    timestamp=b["timestamp"],  # type: ignore[arg-type]
                                    open=as_float(b["open"]),
                                    high=as_float(b["high"]),
                                    low=as_float(b["low"]),
                                    close=float(b["close"]),  # type: ignore[arg-type]
                                    volume=as_float(b["volume"]),
                                )
                                for b in parsed_1h
                            ]
                    except CMCEndpointUnavailableError as exc:
                        if exc.category == "tier_restricted":
                            async with lock:
                                effective_profile = "BASIC_CAPABILITY_PROFILE"
                    except Exception:
                        pass

                # Basic fallback: /v3/cryptocurrency/quotes/historical -> daily_asset_closes
                if not daily_bars and (budget_state != "CUTOFF" or override_cmc_key):
                    try:
                        q_hist, q_meta = await self.deps.gateway.fetch(  # type: ignore[attr-defined]
                            V3_QUOTES_HIST_ENDPOINT,
                            {"id": item.cmc_id, "interval": "1d", "count": 60, "convert": "USD"},
                            ttl_seconds=_HISTORICAL_DAILY_CACHE_TTL,
                            override_api_key=override_cmc_key,
                            priority="expensive",
                        )
                        if isinstance(q_meta, FetchMeta):
                            async with lock:
                                total_credits += q_meta.credit_cost
                        q_bars = parse_v3_quotes_historical(q_hist, "USD").get(
                            int(item.cmc_id), []
                        )
                        if q_bars:
                            await self.store.upsert_historical_cache(
                                item.asset_id,
                                "DAILY",
                                [
                                    {
                                        "bar_timestamp": b["timestamp"],
                                        "open": None,
                                        "high": None,
                                        "low": None,
                                        "close": b["close"],
                                        "volume": b["volume"],
                                        "source_endpoint": V3_QUOTES_HIST_ENDPOINT,
                                    }
                                    for b in q_bars
                                ],
                            )
                            daily_bars = [
                                OhlcvBar(
                                    timestamp=b["timestamp"],  # type: ignore[arg-type]
                                    open=None,
                                    high=None,
                                    low=None,
                                    close=float(b["close"]),  # type: ignore[arg-type]
                                    volume=as_float(b["volume"]),
                                )
                                for b in q_bars
                            ]
                    except Exception as exc:
                        logger.debug(
                            "v3/quotes/historical failed cid=%s err=%s",
                            item.cmc_id,
                            exc.__class__.__name__,
                        )

                if len(daily_bars) < 7 and self.deps.daily_closes is not None:
                    try:
                        warehouse = await self.deps.daily_closes.list_asset_closes(
                            int(item.cmc_id), limit=90
                        )
                        if warehouse:
                            daily_bars = [
                                OhlcvBar(
                                    timestamp=datetime(
                                        w.utc_date.year,
                                        w.utc_date.month,
                                        w.utc_date.day,
                                        tzinfo=UTC,
                                    ),
                                    open=None,
                                    high=None,
                                    low=None,
                                    close=w.close_price,
                                    volume=w.volume_24h,
                                )
                                for w in warehouse
                            ]
                    except Exception:
                        pass

                indicators[item.cmc_id] = compute_historical_indicators(daily_bars, bars_1h)

                # Selective derivatives for CONFIRMED finalists on Startup/BYOK
                if (
                    "CONFIRMED" in tracks
                    and effective_profile == "STARTUP_CAPABILITY_PROFILE"
                    and (budget_state != "CUTOFF" or override_cmc_key)
                ):
                    try:
                        d_payload, d_meta = await self.deps.gateway.fetch(  # type: ignore[attr-defined]
                            DERIVATIVES_ENDPOINT,
                            {"symbol": item.symbol, "limit": 25},
                            ttl_seconds=3600,
                            override_api_key=override_cmc_key,
                        )
                        if isinstance(d_meta, FetchMeta):
                            async with lock:
                                total_credits += d_meta.credit_cost
                        parsed_deriv = parse_derivatives_pairs(
                            d_payload,
                            expected_symbol=item.symbol,
                            expected_cmc_id=int(item.cmc_id),
                        )
                        funding_vals = [
                            p.funding_rate
                            for p in parsed_deriv.market_pairs
                            if p.funding_rate is not None
                        ]
                        med_funding = median(funding_vals) if funding_vals else None
                        derivs[item.cmc_id] = (parsed_deriv.open_interest, med_funding)
                    except Exception:
                        pass

        # Run in chunks of 10 with heartbeat & cancel checkpoints between chunks
        for idx in range(0, len(finalists), 10):
            if await self.store.is_cancel_requested(user_id, scan_run_id):
                break
            chunk = finalists[idx : idx + 10]
            await asyncio.gather(*(_process_one(item) for item in chunk))
            await self.store.update_scan_run(
                user_id, scan_run_id, {"heartbeat_at": self.deps.now().isoformat()}
            )

        return (
            indicators,
            derivs,
            effective_profile,
            total_credits,
            list(dict.fromkeys(notes)),
        )

    # ------------------------------------------------------------------
    # Query & Mutation Helpers for REST Endpoints
    # ------------------------------------------------------------------

    async def list_scans(self, user_id: str, limit: int = 25) -> list[ScanRunSummary]:
        rows = await self.store.list_scans(user_id, limit=limit)
        return [ScanRunSummary(**self._scan_summary_fields(r)) for r in rows]

    async def get_scan_detail(
        self, user_id: str, scan_run_id: str
    ) -> tuple[ScanRunSummary, list[RejectionSummary]] | None:
        run = await self.store.get_scan(user_id, scan_run_id)
        if run is None:
            return None
        rejs = await self.store.list_rejections(user_id, scan_run_id)
        return (
            ScanRunSummary(**self._scan_summary_fields(run)),
            [RejectionSummary(**self._rejection_fields(r)) for r in rejs],
        )

    async def cancel_scan(self, user_id: str, scan_run_id: str) -> ScanRunSummary | None:
        run = await self.store.get_scan(user_id, scan_run_id)
        if run is None:
            return None
        now_iso = self.deps.now().isoformat()
        patch: dict[str, object] = {"cancel_requested_at": now_iso}
        if run.get("status") == "QUEUED":
            patch["status"] = "CANCELLED"
            patch["completed_at"] = now_iso
        updated = await self.store.update_scan_run(user_id, scan_run_id, patch)
        if updated is None:
            return None
        return ScanRunSummary(**self._scan_summary_fields(updated))

    async def list_candidates(
        self,
        user_id: str,
        *,
        track: str | None = None,
        horizon: str | None = None,
        min_score: float | None = None,
        confidence: str | None = None,
        classification: str | None = None,
        eligibility: str | None = None,
        run_id: str | None = None,
        limit: int = 50,
    ) -> list[CandidateSummary]:
        rows = await self.store.list_candidates(
            user_id,
            track=track,
            horizon=horizon,
            min_score=min_score,
            confidence=confidence,
            classification=classification,
            eligibility=eligibility,
            run_id=run_id,
            limit=limit,
        )
        return [CandidateSummary(**self._candidate_summary_fields(r)) for r in rows]

    async def get_candidate_detail(
        self, user_id: str, candidate_id: str
    ) -> CandidateDetail | None:
        detail = await self.store.get_candidate_detail(user_id, candidate_id)
        if detail is None:
            return None
        row = detail["row"]
        assert isinstance(row, dict)
        evidence_rows = detail["evidence"]
        assert isinstance(evidence_rows, list)
        hist_rows = detail["score_history"]
        assert isinstance(hist_rows, list)

        explanation = row.get("explanation")
        if explanation is None and row.get("adjusted_score") is not None:
            explanation = self._lazy_explanation(row, evidence_rows)
            await self.store.set_candidate_explanation(user_id, candidate_id, explanation)

        return CandidateDetail(
            candidate=CandidateSummary(**self._candidate_summary_fields(row)),
            component_scores=dict(row.get("component_scores") or {}),  # type: ignore[arg-type]
            effective_weights=dict(row.get("effective_weights") or {}),  # type: ignore[arg-type]
            penalties=list(row.get("penalties") or []),  # type: ignore[arg-type]
            rejection_reasons=list(row.get("rejection_reasons") or []),  # type: ignore[arg-type]
            explanation=explanation if isinstance(explanation, dict) else None,
            evidence=[
                EvidenceRecordItem(
                    id=str(e["id"]),
                    evidence_type=str(e["evidence_type"]),
                    metric_name=str(e["metric_name"]),
                    observed_value=e.get("observed_value"),
                    interpretation=str(e.get("interpretation") or ""),
                    direction=str(e.get("direction") or "NEUTRAL"),
                    source_provider=str(e.get("source_provider") or "coinmarketcap"),
                    source_endpoint=str(e.get("source_endpoint") or ""),
                    source_timestamp=str(e.get("source_timestamp") or ""),
                    fetched_at=str(e.get("fetched_at") or ""),
                    quality_status=str(e.get("quality_status") or "VALID"),
                    metadata=dict(e.get("metadata") or {}),  # type: ignore[arg-type]
                )
                for e in evidence_rows
                if isinstance(e, dict)
            ],
            score_history=[
                ScoreHistoryItem(
                    id=str(h["id"]),
                    discovery_track=str(h["discovery_track"]),
                    trading_horizon=str(h["trading_horizon"]),
                    previous_score=as_float(h.get("previous_score")),
                    current_score=as_float(h.get("current_score")),
                    score_delta=as_float(h.get("score_delta")),
                    previous_status=(
                        str(h["previous_status"]) if h.get("previous_status") else None
                    ),
                    current_status=str(h["current_status"]) if h.get("current_status") else None,
                    observed_at=str(h.get("observed_at") or ""),
                )
                for h in hist_rows
                if isinstance(h, dict)
            ],
        )

    @staticmethod
    def _lazy_explanation(
        row: dict[str, object], evidence_rows: list[dict[str, object]]
    ) -> dict[str, object]:
        comp_raw = row.get("component_scores")
        comp_map = comp_raw if isinstance(comp_raw, dict) else {}
        from app.quant.hidden_gems import ComponentEval, PenaltyItem, RejectionReason

        components: dict[str, ComponentEval] = {}
        for name, val in comp_map.items():
            if not isinstance(val, dict):
                continue
            components[str(name)] = ComponentEval(
                name=str(name),
                score=as_float(val.get("score")),
                base_weight=float(as_float(val.get("base_weight")) or 0.0),
                effective_weight=float(as_float(val.get("effective_weight")) or 0.0),
                quality_status=str(val.get("quality_status") or "MISSING"),  # type: ignore[arg-type]
            )
        penalties_raw = row.get("penalties")
        penalties = tuple(
            PenaltyItem(
                code=str(p.get("code") or ""),
                points=float(as_float(p.get("points")) or 0.0),
                reason=str(p.get("reason") or ""),
            )
            for p in (penalties_raw if isinstance(penalties_raw, list) else [])
            if isinstance(p, dict)
        )
        rej_raw = row.get("rejection_reasons")
        rejections = tuple(
            RejectionReason(
                stage=str(r.get("stage") or "ELIGIBILITY"),
                code=str(r.get("code") or ""),
                reason=str(r.get("reason") or ""),
            )
            for r in (rej_raw if isinstance(rej_raw, list) else [])
            if isinstance(r, dict)
        )
        synthetic = ScoredCandidate(
            canonical_provider_id=str(row.get("canonical_provider_id") or ""),
            symbol=str(row.get("symbol") or ""),
            discovery_track=str(row.get("discovery_track") or "EARLY"),  # type: ignore[arg-type]
            trading_horizon=str(row.get("trading_horizon") or "SWING"),  # type: ignore[arg-type]
            score_version=str(row.get("score_version") or HIDDEN_GEM_SCORE_VERSION),
            raw_score=as_float(row.get("raw_score")),
            adjusted_score=as_float(row.get("adjusted_score")),
            valid_weight_coverage=float(as_float(row.get("valid_weight_coverage")) or 0.0),
            confidence_level=str(row.get("confidence_level") or "LOW"),  # type: ignore[arg-type]
            data_confidence=float(as_float(row.get("data_confidence")) or 0.0),
            signal_confidence=float(as_float(row.get("signal_confidence")) or 0.0),
            liquidity_confidence=float(as_float(row.get("liquidity_confidence")) or 0.0),
            liquidity_mode=str(row.get("liquidity_mode") or "PROXY"),  # type: ignore[arg-type]
            classification=str(row.get("classification") or "WATCHLIST"),  # type: ignore[arg-type]
            eligibility_status=str(  # type: ignore[arg-type]
                row.get("eligibility_status") or "WATCHLIST_ONLY"
            ),
            components=components,
            penalties=penalties,
            missing_components=tuple(str(m) for m in (row.get("missing_components") or [])),  # type: ignore[attr-defined]
            rejection_reasons=rejections,
            badges=tuple(str(b) for b in (row.get("badges") or [])),  # type: ignore[attr-defined]
            observations=(),
        )
        return build_deterministic_explanation(synthetic, evidence_rows)

    async def list_configs(self, user_id: str) -> list[ScanConfigItem]:
        rows = await self.store.list_configs(user_id)
        return [ScanConfigItem(**self._config_fields(r)) for r in rows]

    async def create_config(self, user_id: str, body: ScanConfigCreate) -> ScanConfigItem:
        row = {
            "user_id": user_id,
            "name": body.name,
            "description": body.description,
            "discovery_track": body.discovery_track,
            "trading_horizon": body.trading_horizon,
            "universe_config": body.universe_config,
            "filter_config": body.filter_config,
            "scoring_config": body.scoring_config,
            "schedule_config": body.schedule_config,
            "is_default": body.is_default,
            "is_active": True,
        }
        created = await self.store.create_config(row)
        return ScanConfigItem(**self._config_fields(created))

    async def update_config(
        self, user_id: str, config_id: str, body: ScanConfigUpdate
    ) -> ScanConfigItem | None:
        patch = body.model_dump(exclude_none=True)
        if not patch:
            existing = await self.store.list_configs(user_id)
            found = next((c for c in existing if str(c.get("id")) == config_id), None)
            return ScanConfigItem(**self._config_fields(found)) if found else None
        updated = await self.store.update_config(user_id, config_id, patch)
        return ScanConfigItem(**self._config_fields(updated)) if updated else None

    async def list_watchlist(self, user_id: str) -> list[WatchlistItem]:
        rows = await self.store.list_watchlist(user_id)
        return [WatchlistItem(**self._watchlist_fields(r)) for r in rows]

    async def upsert_watchlist(
        self, user_id: str, body: WatchlistAddRequest
    ) -> WatchlistItem:
        created = await self.store.upsert_watchlist(
            {
                "user_id": user_id,
                "asset_id": body.asset_id,
                "candidate_result_id": body.candidate_result_id,
                "watch_status": "ACTIVE",
                "user_note": body.user_note,
            }
        )
        return WatchlistItem(**self._watchlist_fields(created))

    async def delete_watchlist(self, user_id: str, item_id: str) -> bool:
        return await self.store.delete_watchlist(user_id, item_id)

    async def list_alerts(self, user_id: str, limit: int = 50) -> list[AlertEventItem]:
        rows = await self.store.list_alerts(user_id, limit=limit)
        return [
            AlertEventItem(
                id=str(a["id"]),
                asset_id=str(a["asset_id"]),
                scan_run_id=str(a["scan_run_id"]) if a.get("scan_run_id") else None,
                candidate_result_id=(
                    str(a["candidate_result_id"]) if a.get("candidate_result_id") else None
                ),
                event_type=str(a["event_type"]),
                severity=str(a["severity"]),
                dedup_key=str(a["dedup_key"]),
                payload=dict(a.get("payload") or {}),  # type: ignore[arg-type]
                delivery_channel=str(a.get("delivery_channel") or "IN_APP"),
                delivery_status=str(a.get("delivery_status") or "PENDING"),
                created_at=str(a["created_at"]) if a.get("created_at") else None,
            )
            for a in rows
        ]

    async def get_quality_stats(self, user_id: str) -> list[QualityStatsRow]:
        rows = await self.store.list_outcome_checkpoints(user_id)
        grouped: dict[tuple[str, str, str], list[dict[str, object]]] = {}
        for row in rows:
            key = (
                str(row.get("score_version") or HIDDEN_GEM_SCORE_VERSION),
                str(row.get("discovery_track") or "EARLY"),
                str(row.get("effective_tier") or "TRACKED"),
            )
            grouped.setdefault(key, []).append(row)

        out: list[QualityStatsRow] = []
        for (version, track, tier), items in sorted(grouped.items()):
            ret_7d_vals = [
                val
                for val in (as_float(i.get("ret_7d") or i.get("return_7d")) for i in items)
                if val is not None
            ]
            rel_btc_vals = [
                val
                for val in (
                    as_float(i.get("rel_btc_7d") or i.get("relative_btc_return_7d"))
                    for i in items
                )
                if val is not None
            ]
            mae_vals = [
                val
                for val in (
                    as_float(i.get("mae_30d") or i.get("max_adverse_excursion_30d"))
                    for i in items
                )
                if val is not None
            ]
            pos_rate = (
                round(sum(1 for r in ret_7d_vals if r > 0.0) / len(ret_7d_vals), 4)
                if ret_7d_vals
                else None
            )
            avg_rel = (
                round(sum(rel_btc_vals) / len(rel_btc_vals), 4) if rel_btc_vals else None
            )
            mean_mae = round(sum(mae_vals) / len(mae_vals), 4) if mae_vals else None
            out.append(
                QualityStatsRow(
                    score_version=version,
                    discovery_track=track,
                    effective_tier=tier,
                    total_tracked=len(items),
                    evaluated_7d=len(ret_7d_vals),
                    positive_7d_rate=pos_rate,
                    avg_rel_btc_7d=avg_rel,
                    mean_mae_30d=mean_mae,
                )
            )
        return out

    async def run_zombie_watchdog(self, stale_seconds: int = _STALE_HEARTBEAT_SECONDS) -> int:
        cutoff = self.deps.now() - timedelta(seconds=stale_seconds)
        return await self.store.mark_stale_running_scans_failed(cutoff)

    async def _dispatch_telegram_alerts(
        self,
        *,
        user_id: str,
        scan_run_id: str,
        config: dict[str, object] | None,
    ) -> int:
        sched = config.get("schedule_config") if isinstance(config, dict) else {}
        sched_dict = sched if isinstance(sched, dict) else {}
        if sched_dict.get("telegram_enabled") is False:
            return 0
        chat_id = (
            str(sched_dict["telegram_chat_id"])
            if isinstance(sched_dict.get("telegram_chat_id"), str)
            and sched_dict["telegram_chat_id"].strip()
            else None
        )
        notifier = self.telegram
        if not notifier.is_configured and not (chat_id and notifier._token):
            return 0

        recent = await self.store.list_alerts(user_id, limit=50)
        targets = [
            al
            for al in recent
            if al.get("scan_run_id") == scan_run_id
            and (
                al.get("severity") in ("HIGH", "CRITICAL")
                or al.get("event_type") in ("NEW_DISCOVERY", "CONFIRMATION")
            )
        ]
        sent_count = 0
        now_iso = self.deps.now().isoformat()
        for alert in targets:
            res = await notifier.send_alert(alert, chat_id=chat_id)
            if not res.attempted:
                continue
            if res.sent:
                sent_count += 1
                await self.store.update_alert_delivery(
                    str(alert["id"]),
                    {
                        "delivery_channel": "TELEGRAM",
                        "delivery_status": "SENT",
                        "delivered_at": now_iso,
                    },
                )
            else:
                await self.store.update_alert_delivery(
                    str(alert["id"]),
                    {
                        "delivery_channel": "TELEGRAM",
                        "delivery_status": "FAILED",
                    },
                )
        return sent_count

    async def send_test_telegram(
        self, user_id: str, *, chat_id: str | None = None
    ) -> dict[str, object]:
        notifier = self.telegram
        sample = {
            "event_type": "NEW_DISCOVERY",
            "severity": "MEDIUM",
            "asset_id": user_id,
            "payload": {
                "symbol": "COINTRAC-TEST",
                "track": "EARLY",
                "horizon": "SWING",
                "adjusted_score": 82.5,
            },
        }
        res = await notifier.send_alert(sample, chat_id=chat_id)
        return {
            "configured": notifier.is_configured,
            "attempted": res.attempted,
            "sent": res.sent,
            "error": res.error,
        }

    async def evaluate_outcome_checkpoints(self) -> int:
        now = self.deps.now()
        since = now - timedelta(days=35)
        active = await self.store.list_active_checkpoints_all(since)
        if not active:
            return 0

        asset_ids = list({str(cp["asset_id"]) for cp in active if cp.get("asset_id")})
        btc_asset_id = await self.store.get_asset_id_by_cmc_id("1")
        if btc_asset_id and btc_asset_id not in asset_ids:
            asset_ids.append(btc_asset_id)

        latest_snaps = await self.store.get_latest_snapshots_for_assets(asset_ids)
        btc_snap = latest_snaps.get(btc_asset_id) if btc_asset_id else None
        btc_now_price = as_float(btc_snap.get("price")) if btc_snap else None

        updated = 0
        for cp in active:
            cid = str(cp.get("id") or "")
            aid = str(cp.get("asset_id") or "")
            entry_price = as_float(cp.get("entry_price"))
            entry_btc = as_float(cp.get("entry_btc_price"))
            entry_ts = parse_timestamp(cp.get("entry_observed_at"))
            if not cid or not aid or not entry_price or entry_price <= 0 or entry_ts is None:
                continue

            snap = latest_snaps.get(aid)
            cur_price = as_float(snap.get("price")) if snap else None
            if cur_price is None or cur_price <= 0:
                continue

            obs_ts = parse_timestamp(snap.get("observed_at")) if snap else None
            eval_ts = obs_ts or now
            elapsed_hours = (eval_ts - entry_ts).total_seconds() / 3600.0
            if elapsed_hours < 0:
                continue

            cur_ret = ((cur_price / entry_price) - 1.0) * 100.0
            btc_ret: float | None = None
            if btc_now_price and btc_now_price > 0 and entry_btc and entry_btc > 0:
                btc_ret = ((btc_now_price / entry_btc) - 1.0) * 100.0

            patch: dict[str, object] = {"last_evaluated_at": now.isoformat()}
            if elapsed_hours <= 720.0 + 24.0:
                prev_mfe = as_float(cp.get("mfe_30d"))
                prev_mae = as_float(cp.get("mae_30d"))
                patch["mfe_30d"] = (
                    round(max(prev_mfe, cur_ret), 4) if prev_mfe is not None else round(cur_ret, 4)
                )
                patch["mae_30d"] = (
                    round(min(prev_mae, cur_ret), 4) if prev_mae is not None else round(cur_ret, 4)
                )

            if elapsed_hours >= 24.0 and cp.get("ret_1d") is None:
                patch["ret_1d"] = round(cur_ret, 4)
            if elapsed_hours >= 72.0 and cp.get("ret_3d") is None:
                patch["ret_3d"] = round(cur_ret, 4)
            if elapsed_hours >= 168.0 and cp.get("ret_7d") is None:
                patch["ret_7d"] = round(cur_ret, 4)
                rel_7 = geometric_rs(cur_ret, btc_ret)
                if rel_7 is not None:
                    patch["rel_btc_7d"] = round(rel_7, 4)
            if elapsed_hours >= 336.0 and cp.get("ret_14d") is None:
                patch["ret_14d"] = round(cur_ret, 4)
            if elapsed_hours >= 720.0 and cp.get("ret_30d") is None:
                patch["ret_30d"] = round(cur_ret, 4)
                rel_30 = geometric_rs(cur_ret, btc_ret)
                if rel_30 is not None:
                    patch["rel_btc_30d"] = round(rel_30, 4)

            if len(patch) > 1 or cp.get("last_evaluated_at") is None:
                await self.store.update_checkpoint(cid, patch)
                updated += 1
        return updated

    async def run_due_scheduled_scans(self, *, run_inline: bool = False) -> int:
        snap = await self.budget.snapshot()
        if snap.state == "CUTOFF":
            return 0
        configs = await self.store.list_active_configs_all()
        if not configs:
            return 0

        now = self.deps.now()
        triggered = 0
        for cfg in configs:
            sched = cfg.get("schedule_config")
            if not isinstance(sched, dict) or not bool(sched.get("enabled")):
                continue
            raw_interval = sched.get("interval_minutes")
            interval_min = (
                max(60, int(raw_interval))
                if isinstance(raw_interval, (int, float)) and not isinstance(raw_interval, bool)
                else 360
            )
            last_dt = parse_timestamp(sched.get("last_triggered_at"))
            if last_dt is not None and (now - last_dt).total_seconds() < interval_min * 60:
                continue

            user_id = str(cfg.get("user_id") or "")
            config_id = str(cfg.get("id") or "")
            if not user_id or not config_id:
                continue

            recent_runs = await self.store.list_scans(user_id, limit=5)
            if any(r.get("status") in ("QUEUED", "RUNNING") for r in recent_runs):
                continue

            next_sched = {**sched, "last_triggered_at": now.isoformat()}
            await self.store.update_config(user_id, config_id, {"schedule_config": next_sched})

            track = str(cfg.get("discovery_track") or "BOTH")
            horizon = str(cfg.get("trading_horizon") or "BOTH")
            u_cfg = cfg.get("universe_config")
            u_limit = (
                int(u_cfg["limit"])
                if isinstance(u_cfg, dict) and isinstance(u_cfg.get("limit"), int)
                else None
            )
            slot = int(now.timestamp() // (interval_min * 60))
            await self.enqueue_scan(
                user_id=user_id,
                req=CreateScanRequest(
                    track=track if track in ("EARLY", "CONFIRMED", "BOTH") else "BOTH",  # type: ignore[arg-type]
                    horizon=(
                        horizon if horizon in ("SHORT_TERM", "SWING", "BOTH") else "BOTH"  # type: ignore[arg-type]
                    ),
                    config_id=config_id,
                    universe_limit=u_limit,
                ),
                idempotency_key=f"sched:{config_id}:{slot}",
                run_inline=run_inline,
            )
            triggered += 1
        return triggered

    @staticmethod
    def _scan_summary_fields(row: dict[str, object]) -> dict[str, object]:
        return {
            "id": str(row["id"]),
            "status": str(row.get("status") or "QUEUED"),
            "discovery_track": str(row.get("discovery_track") or "BOTH"),
            "trading_horizon": str(row.get("trading_horizon") or "BOTH"),
            "effective_tier": str(row.get("effective_tier") or "BASIC"),
            "evaluation_profile": str(
                row.get("evaluation_profile") or "BASIC_CAPABILITY_PROFILE"
            ),
            "baseline_mode": str(row.get("baseline_mode") or "CROSS_SECTIONAL_UNIVERSE"),
            "market_regime": str(row.get("market_regime") or "UNKNOWN"),
            "universe_requested": int(row.get("universe_requested") or 0),  # type: ignore[call-overload]
            "universe_scanned": int(row.get("universe_scanned") or 0),  # type: ignore[call-overload]
            "candidates_discovered": int(row.get("candidates_discovered") or 0),  # type: ignore[call-overload]
            "candidates_eligible": int(row.get("candidates_eligible") or 0),  # type: ignore[call-overload]
            "candidates_rejected": int(row.get("candidates_rejected") or 0),  # type: ignore[call-overload]
            "cmc_credits_consumed": int(row.get("cmc_credits_consumed") or 0),  # type: ignore[call-overload]
            "source_metadata": dict(row.get("source_metadata") or {}),  # type: ignore[arg-type]
            "budget_metadata": dict(row.get("budget_metadata") or {}),  # type: ignore[arg-type]
            "heartbeat_at": str(row["heartbeat_at"]) if row.get("heartbeat_at") else None,
            "cancel_requested_at": (
                str(row["cancel_requested_at"]) if row.get("cancel_requested_at") else None
            ),
            "started_at": str(row["started_at"]) if row.get("started_at") else None,
            "completed_at": str(row["completed_at"]) if row.get("completed_at") else None,
            "error_summary": str(row["error_summary"]) if row.get("error_summary") else None,
            "created_at": str(row["created_at"]) if row.get("created_at") else None,
        }

    @staticmethod
    def _rejection_fields(row: dict[str, object]) -> dict[str, object]:
        return {
            "id": str(row["id"]),
            "asset_id": str(row["asset_id"]) if row.get("asset_id") else None,
            "symbol": str(row["symbol"]) if row.get("symbol") else None,
            "rejection_stage": str(row.get("rejection_stage") or "HARD_GATE"),
            "rejection_code": str(row.get("rejection_code") or ""),
            "rejection_reason": str(row.get("rejection_reason") or ""),
            "observed_metrics": dict(row.get("observed_metrics") or {}),  # type: ignore[arg-type]
            "created_at": str(row["created_at"]) if row.get("created_at") else None,
        }

    @staticmethod
    def _candidate_summary_fields(row: dict[str, object]) -> dict[str, object]:
        return {
            "id": str(row["id"]),
            "scan_run_id": str(row["scan_run_id"]),
            "asset_id": str(row["asset_id"]),
            "canonical_provider_id": str(row.get("canonical_provider_id") or ""),
            "symbol": str(row.get("symbol") or ""),
            "name": str(row.get("name") or ""),
            "discovery_track": str(row.get("discovery_track") or "EARLY"),
            "trading_horizon": str(row.get("trading_horizon") or "SWING"),
            "price": as_float(row.get("price")),
            "market_cap": as_float(row.get("market_cap")),
            "volume_24h": as_float(row.get("volume_24h")),
            "return_24h": as_float(row.get("return_24h")),
            "return_7d": as_float(row.get("return_7d")),
            "rs_btc_7d": as_float(row.get("rs_btc_7d")),
            "raw_score": as_float(row.get("raw_score")),
            "adjusted_score": as_float(row.get("adjusted_score")),
            "valid_weight_coverage": float(as_float(row.get("valid_weight_coverage")) or 0.0),
            "confidence_level": str(row.get("confidence_level") or "LOW"),
            "data_confidence": float(as_float(row.get("data_confidence")) or 0.0),
            "signal_confidence": float(as_float(row.get("signal_confidence")) or 0.0),
            "liquidity_confidence": float(as_float(row.get("liquidity_confidence")) or 0.0),
            "liquidity_mode": str(row.get("liquidity_mode") or "PROXY"),
            "classification": str(row.get("classification") or "WATCHLIST"),
            "eligibility_status": str(row.get("eligibility_status") or "WATCHLIST_ONLY"),
            "score_version": str(row.get("score_version") or HIDDEN_GEM_SCORE_VERSION),
            "badges": list(row.get("badges") or []),  # type: ignore[arg-type]
            "missing_components": list(row.get("missing_components") or []),  # type: ignore[arg-type]
            "source_timestamp": (
                str(row["source_timestamp"]) if row.get("source_timestamp") else None
            ),
            "created_at": str(row["created_at"]) if row.get("created_at") else None,
        }

    @staticmethod
    def _config_fields(row: dict[str, object]) -> dict[str, object]:
        return {
            "id": str(row["id"]),
            "name": str(row["name"]),
            "description": str(row["description"]) if row.get("description") else None,
            "discovery_track": str(row.get("discovery_track") or "BOTH"),
            "trading_horizon": str(row.get("trading_horizon") or "BOTH"),
            "universe_config": dict(row.get("universe_config") or {}),  # type: ignore[arg-type]
            "filter_config": dict(row.get("filter_config") or {}),  # type: ignore[arg-type]
            "scoring_config": dict(row.get("scoring_config") or {}),  # type: ignore[arg-type]
            "schedule_config": dict(row.get("schedule_config") or {}),  # type: ignore[arg-type]
            "is_default": bool(row.get("is_default", False)),
            "is_active": bool(row.get("is_active", True)),
            "created_at": str(row["created_at"]) if row.get("created_at") else None,
            "updated_at": str(row["updated_at"]) if row.get("updated_at") else None,
        }

    @staticmethod
    def _watchlist_fields(row: dict[str, object]) -> dict[str, object]:
        return {
            "id": str(row["id"]),
            "asset_id": str(row["asset_id"]),
            "symbol": str(row["symbol"]) if row.get("symbol") else None,
            "name": str(row["name"]) if row.get("name") else None,
            "candidate_result_id": (
                str(row["candidate_result_id"]) if row.get("candidate_result_id") else None
            ),
            "watch_status": str(row.get("watch_status") or "ACTIVE"),
            "user_note": str(row["user_note"]) if row.get("user_note") else None,
            "added_at": str(row["added_at"]) if row.get("added_at") else None,
            "updated_at": str(row["updated_at"]) if row.get("updated_at") else None,
        }


def get_hidden_gem_service() -> HiddenGemService:
    return HiddenGemService()
