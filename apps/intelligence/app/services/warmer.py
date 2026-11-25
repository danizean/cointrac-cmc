"""Lightweight CoinMarketCap cache warmer sharing the CMCClient cache and ledger.

Measured 30-day model at 1 credit per call, base intervals below:
- listings every 30 minutes: 1,440 credits
- global metrics every 60 minutes: 720 credits
- fear-and-greed every 6 hours: 120 credits
- asset map every 7 days: 4 credits
Total about 2,284 credits, under the warmer ceiling of 40 percent of a 10,000
credit Basic budget (4,000). The other 60 percent stays available for user calls.

The warmer stays off unless CMC_WARMER_ENABLED is set. That default is intentional:
this estimate is a schedule model, not a live measurement of CMC credit_count.

CONSERVATION stretches every interval by 3. ELEVATED stretches by 1.5.
EMERGENCY keeps only listings and global metrics, on a 6x interval.
CUTOFF and the warmer credit ceiling skip every job.
A failed attempt updates last_attempt and does not update last_success.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal

from app.adapters.cmc_client import CMCClient
from app.services.budget import (
    BudgetController,
    BudgetState,
    BudgetWarningLevel,
    warmer_credit_ceiling,
)
from app.services.daily_closes import DailyCloseStore, capture_daily_closes_from_listings
from app.services.market_events import STREAM_ENDPOINTS, MarketSnapshotEvent, get_market_event_bus
from app.services.tier_detection import get_tier_detector

logger = logging.getLogger("cointrac.warmer")

WarmerOutcome = Literal[
    "ok",
    "cached",
    "fallback",
    "skipped_cutoff",
    "skipped_not_due",
    "skipped_emergency",
    "skipped_user_reserve",
    "error",
]

ESSENTIAL_WARMER_JOBS = frozenset({"listings_top200", "global_metrics"})


@dataclass(frozen=True)
class WarmerJob:
    name: str
    endpoint: str
    params: dict[str, object]
    interval_seconds: int


@dataclass(frozen=True)
class WarmerRunResult:
    job: str
    outcome: WarmerOutcome
    duration_ms: float
    data_mode: str | None = None
    credit_cost: int = 0
    error_type: str | None = None


BASIC_WARMER_JOBS: tuple[WarmerJob, ...] = (
    WarmerJob(
        name="listings_top200",
        endpoint="/v1/cryptocurrency/listings/latest",
        params={"start": 1, "limit": 200, "convert": "USD"},
        interval_seconds=1800,
    ),
    WarmerJob(
        name="global_metrics",
        endpoint="/v1/global-metrics/quotes/latest",
        params={"convert": "USD"},
        interval_seconds=3600,
    ),
    WarmerJob(
        name="fear_and_greed",
        endpoint="/v3/fear-and-greed/latest",
        params={},
        interval_seconds=21600,
    ),
    WarmerJob(
        name="asset_map",
        endpoint="/v1/cryptocurrency/map",
        params={"start": 1, "limit": 500},
        interval_seconds=604800,
    ),
)

STARTUP_NORMAL_INTERVALS = {
    "listings_top200": 60,
    "quotes_btc_eth": 60,
    "global_metrics": 120,
    "fear_and_greed": 120,
}

STARTUP_QUOTES_JOB = WarmerJob(
    name="quotes_btc_eth",
    endpoint="/v2/cryptocurrency/quotes/latest",
    params={"id": "1,1027", "convert": "USD"},
    interval_seconds=60,
)


def warmer_interval_multiplier(state: BudgetState, warning: BudgetWarningLevel) -> float:
    if state == "CUTOFF":
        return 12.0
    if state == "EMERGENCY":
        return 6.0
    if state == "CONSERVATION":
        return 3.0
    if warning == "ELEVATED":
        return 1.5
    return 1.0


def projected_monthly_credits(
    jobs: Sequence[WarmerJob] = BASIC_WARMER_JOBS,
    *,
    days: int = 30,
    credit_per_call: int = 1,
    multiplier: float = 1.0,
) -> int:
    window = days * 86400
    total = 0
    for job in jobs:
        interval = max(1, int(job.interval_seconds * multiplier))
        total += (window // interval) * credit_per_call
    return total


class CacheWarmer:
    def __init__(
        self,
        client: CMCClient,
        *,
        budget_controller: BudgetController | None = None,
        daily_close_store: DailyCloseStore | None = None,
        jobs: Sequence[WarmerJob] = BASIC_WARMER_JOBS,
        tick_seconds: float = 30.0,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._client = client
        self._budget = budget_controller or client.budget_controller
        self._daily_closes = daily_close_store
        self._jobs = tuple(jobs)
        self._tick_seconds = max(0.05, float(tick_seconds))
        self._now = now or (lambda: datetime.now(UTC))
        self._last_attempt: dict[str, datetime] = {}
        self._last_success: dict[str, datetime] = {}
        self._last_outcome: dict[str, WarmerOutcome] = {}
        self._last_daily_close_date: date | None = None
        self._task: asyncio.Task[None] | None = None
        self._stop_event: asyncio.Event | None = None
        self._start_count: int = 0

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def active_task(self) -> asyncio.Task[None] | None:
        return self._task if self.is_running else None

    @property
    def start_count(self) -> int:
        return self._start_count

    @property
    def last_attempt(self) -> dict[str, datetime]:
        return dict(self._last_attempt)

    @property
    def last_success(self) -> dict[str, datetime]:
        return dict(self._last_success)

    def start(self) -> bool:
        """Start the background warmer loop idempotently (never spawns duplicate tasks)."""
        if self._task is not None and not self._task.done():
            logger.debug("cache warmer already running; ignoring duplicate start request")
            return False
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="cointrac-cache-warmer")
        self._start_count += 1
        logger.info(
            "cache warmer started jobs=%d tick_seconds=%.1f",
            len(self._jobs),
            self._tick_seconds,
        )
        return True

    async def stop(self) -> None:
        """Stop the background warmer loop cleanly."""
        if self._stop_event is not None:
            self._stop_event.set()
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        logger.info("cache warmer stopped")

    async def run_once(self) -> list[WarmerRunResult]:
        """Run all due warmer jobs once. Never raises into caller."""
        now = self._now()
        try:
            snap = await self._budget.snapshot()
        except Exception as exc:
            logger.warning("cache warmer budget check failed (%s)", exc.__class__.__name__)
            return [
                WarmerRunResult(
                    job="budget_check",
                    outcome="error",
                    duration_ms=0.0,
                    error_type=exc.__class__.__name__,
                )
            ]

        if snap.ledger_status != "ok" or snap.state == "CUTOFF":
            logger.info(
                "cache warmer halted: budget state=%s ledger=%s",
                snap.state,
                snap.ledger_status,
            )
            return [
                WarmerRunResult(
                    job="all",
                    outcome="skipped_cutoff",
                    duration_ms=0.0,
                    data_mode=None,
                    credit_cost=0,
                )
            ]
        ceiling = warmer_credit_ceiling(snap.monthly_budget_credits)
        warmer_used = snap.warmer_credits_this_month or 0
        if warmer_used >= ceiling:
            return [
                WarmerRunResult(
                    job="all",
                    outcome="skipped_user_reserve",
                    duration_ms=0.0,
                )
            ]

        results: list[WarmerRunResult] = []
        jobs = list(self._jobs)
        if get_tier_detector().startup_features_open(
            state=snap.state,
            warning_level=snap.warning_level,
            ledger_status=snap.ledger_status,
        ) and not any(job.name == STARTUP_QUOTES_JOB.name for job in jobs):
            jobs.append(STARTUP_QUOTES_JOB)
        for job in jobs:
            try:
                current_snap = await self._budget.snapshot()
            except Exception as exc:
                logger.warning("cache warmer budget recheck failed (%s)", exc.__class__.__name__)
                results.append(
                    WarmerRunResult(
                        job=job.name,
                        outcome="error",
                        duration_ms=0.0,
                        error_type=exc.__class__.__name__,
                    )
                )
                continue
            if current_snap.ledger_status != "ok" or current_snap.state == "CUTOFF":
                results.append(
                    WarmerRunResult(job=job.name, outcome="skipped_cutoff", duration_ms=0.0)
                )
                continue
            if (current_snap.warmer_credits_this_month or 0) >= warmer_credit_ceiling(
                current_snap.monthly_budget_credits
            ):
                results.append(
                    WarmerRunResult(job=job.name, outcome="skipped_user_reserve", duration_ms=0.0)
                )
                continue
            if current_snap.state == "EMERGENCY" and job.name not in ESSENTIAL_WARMER_JOBS:
                results.append(
                    WarmerRunResult(job=job.name, outcome="skipped_emergency", duration_ms=0.0)
                )
                continue
            multiplier = warmer_interval_multiplier(current_snap.state, current_snap.warning_level)
            startup_interval = None
            if get_tier_detector().startup_features_open(
                state=current_snap.state,
                warning_level=current_snap.warning_level,
                ledger_status=current_snap.ledger_status,
            ):
                startup_interval = STARTUP_NORMAL_INTERVALS.get(job.name)
            interval = (
                float(startup_interval)
                if startup_interval is not None
                else job.interval_seconds * multiplier
            )
            if self._last_outcome.get(job.name) in {"ok", "cached"}:
                anchor = self._last_success.get(job.name)
            else:
                anchor = self._last_attempt.get(job.name)
            if anchor is not None and (now - anchor).total_seconds() < interval:
                results.append(
                    WarmerRunResult(job=job.name, outcome="skipped_not_due", duration_ms=0.0)
                )
                continue

            started = time.perf_counter()
            self._last_attempt[job.name] = now
            try:
                _payload, meta = await self._client.fetch(
                    job.endpoint,
                    dict(job.params),
                    priority="core_warmer",
                    cache_status="WARMER_MISS",
                    budget_caller="warmer",
                )
                elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)
                if meta.cache_hit:
                    outcome: WarmerOutcome = "cached"
                elif meta.data_mode == "VERIFIED_SNAPSHOT_FALLBACK":
                    outcome = "fallback"
                else:
                    outcome = "ok"
                self._last_outcome[job.name] = outcome
                if outcome in {"ok", "cached"}:
                    self._last_success[job.name] = now
                if outcome == "ok" and job.endpoint in STREAM_ENDPOINTS:
                    retrieved = meta.retrieved_at or now
                    get_market_event_bus().publish(
                        MarketSnapshotEvent(
                            endpoint=job.endpoint,
                            retrieved_at_utc=retrieved,
                            cadence_seconds=max(1, int(interval)),
                            effective_tier=get_tier_detector().effective_profile(),
                        )
                    )
                logger.info(
                    "cache warmer job=%s outcome=%s mode=%s credits=%d duration_ms=%.2f",
                    job.name,
                    outcome,
                    meta.data_mode,
                    meta.credit_cost,
                    elapsed_ms,
                )
                results.append(
                    WarmerRunResult(
                        job=job.name,
                        outcome=outcome,
                        duration_ms=elapsed_ms,
                        data_mode=meta.data_mode,
                        credit_cost=meta.credit_cost,
                    )
                )
            except Exception as exc:
                elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)
                self._last_outcome[job.name] = "error"
                logger.warning(
                    "cache warmer job=%s outcome=error error_type=%s duration_ms=%.2f",
                    job.name,
                    exc.__class__.__name__,
                    elapsed_ms,
                )
                results.append(
                    WarmerRunResult(
                        job=job.name,
                        outcome="error",
                        duration_ms=elapsed_ms,
                        error_type=exc.__class__.__name__,
                    )
                )

        # Daily reference closes capture (reuses listings snapshot; zero extra CMC calls)
        if self._daily_closes is not None:
            utc_today = now.astimezone(UTC).date()
            if self._last_daily_close_date != utc_today:
                started = time.perf_counter()
                try:
                    capture = await capture_daily_closes_from_listings(
                        snapshot_store=self._client.snapshot_store,
                        close_store=self._daily_closes,
                        now=now,
                    )
                    elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)
                    if capture.rows_written > 0:
                        self._last_daily_close_date = utc_today
                        logger.info(
                            "daily_asset_closes captured date=%s rows=%d duration_ms=%.2f",
                            utc_today.isoformat(),
                            capture.rows_written,
                            elapsed_ms,
                        )
                except Exception as exc:
                    elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)
                    logger.warning(
                        "daily_asset_closes capture failed error_type=%s duration_ms=%.2f",
                        exc.__class__.__name__,
                        elapsed_ms,
                    )

        return results

    async def _run_loop(self) -> None:
        stop_event = self._stop_event
        if stop_event is None:
            return
        while not stop_event.is_set():
            try:
                await self.run_once()
            except Exception as exc:
                logger.warning(
                    "cache warmer loop tick failed error_type=%s",
                    exc.__class__.__name__,
                )
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=self._tick_seconds)
            except TimeoutError:
                continue
