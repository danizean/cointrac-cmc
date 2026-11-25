"""Langkah 4 — startup cadence, tier detection, and Deep Scan downgrade."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from tests.test_budget_integrity import MemorySnapshotStore
from tests.test_mcp import research_deps

from app.adapters.cmc_client import CMCClient, FetchMeta
from app.core.config import get_settings
from app.schemas.tools import ScanMoversInput
from app.services.budget import BudgetController, MemoryBudgetStore, install_budget_controller
from app.services.intelligence import scan_market_movers
from app.services.tier_detection import TierDetector, install_tier_detector, plan_label_to_tier
from app.services.warmer import BASIC_WARMER_JOBS, STARTUP_QUOTES_JOB, CacheWarmer

BASE = "https://pro-api.coinmarketcap.com"
NOW = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)


def test_plan_labels_only_map_known_tiers() -> None:
    assert plan_label_to_tier("Startup") == "startup"
    assert plan_label_to_tier("Basic") == "basic"
    assert plan_label_to_tier("Hobbyist") == "unknown"
    assert plan_label_to_tier(None) == "unknown"


class _KeyInfo:
    def __init__(self) -> None:
        self.calls = 0

    async def fetch(self, endpoint: str, params: dict[str, object], **kwargs: object):
        del params
        assert endpoint == "/v1/key/info"
        assert kwargs["persist_snapshot"] is False
        self.calls += 1
        return (
            {
                "data": {
                    "plan": {"name": "Basic"},
                    "usage": {"current_month": {"credits_left": 80}},
                }
            },
            object(),
        )


@pytest.mark.asyncio
async def test_key_info_is_not_cached_and_explicit_profile_wins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CMC_API_KEY", "unit-test-key-a")
    monkeypatch.setenv("CMC_QUOTA_PROFILE", "startup")
    get_settings.cache_clear()
    detector = TierDetector()
    client = _KeyInfo()
    install_tier_detector(detector)
    try:
        first = await detector.refresh(client, now=NOW)
        second = await detector.refresh(client, now=NOW + timedelta(minutes=10))
        assert first.detected_tier == "basic"
        assert first.remaining_credits == 80
        assert second.detected_tier == "basic"
        assert client.calls == 1
        assert detector.effective_profile() == "startup"
        monkeypatch.setenv("CMC_QUOTA_PROFILE", "adaptive")
        get_settings.cache_clear()
        assert detector.effective_profile() == "basic"
        monkeypatch.setenv("CMC_API_KEY", "unit-test-key-b")
        get_settings.cache_clear()
        await detector.refresh(client, now=NOW + timedelta(minutes=20))
        assert client.calls == 2
    finally:
        install_tier_detector(None)
        get_settings.cache_clear()


def _mock_jobs(router: respx.MockRouter) -> None:
    for job in (*BASIC_WARMER_JOBS, STARTUP_QUOTES_JOB):
        router.get(f"{BASE}{job.endpoint}").mock(
            return_value=httpx.Response(
                200, json={"data": {}, "status": {"error_code": 0, "credit_count": 1}}
            )
        )


@pytest.mark.asyncio
async def test_startup_normal_cadence_is_faster_and_basic_cadence_stays(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = {"now": NOW}

    async def _sleep(_seconds: float) -> None:
        return None

    install_tier_detector(TierDetector())
    try:
        monkeypatch.setenv("CMC_QUOTA_PROFILE", "startup")
        get_settings.cache_clear()
        startup = BudgetController(
            quota_profile="startup",
            monthly_budget=450_000,
            store=MemoryBudgetStore(),
            now=lambda: clock["now"],
        )
        with respx.mock(assert_all_called=False) as router:
            _mock_jobs(router)
            async with CMCClient(
                api_key="server-key",
                base_url=BASE,
                snapshot_store=MemorySnapshotStore(),
                budget_controller=startup,
                simulate_basic_tier=False,
                sleep=_sleep,
                now=lambda: clock["now"],
            ) as client:
                warmer = CacheWarmer(client, budget_controller=startup, now=lambda: clock["now"])
                await warmer.run_once()
                clock["now"] = NOW + timedelta(seconds=90)
                second = await warmer.run_once()
        by_job = {item.job: item.outcome for item in second}
        assert by_job["listings_top200"] in {"ok", "cached"}
        assert by_job["quotes_btc_eth"] in {"ok", "cached"}
        assert by_job["global_metrics"] == "skipped_not_due"

        monkeypatch.setenv("CMC_QUOTA_PROFILE", "basic")
        get_settings.cache_clear()
        clock["now"] = NOW
        basic = BudgetController(
            quota_profile="basic",
            monthly_budget=10_000,
            store=MemoryBudgetStore(),
            now=lambda: clock["now"],
        )
        with respx.mock(assert_all_called=False) as router:
            _mock_jobs(router)
            async with CMCClient(
                api_key="server-key",
                base_url=BASE,
                snapshot_store=MemorySnapshotStore(),
                budget_controller=basic,
                simulate_basic_tier=False,
                sleep=_sleep,
                now=lambda: clock["now"],
            ) as client:
                warmer = CacheWarmer(client, budget_controller=basic, now=lambda: clock["now"])
                await warmer.run_once()
                clock["now"] = NOW + timedelta(seconds=90)
                second = await warmer.run_once()
        assert all(item.outcome == "skipped_not_due" for item in second)
        assert "quotes_btc_eth" not in {item.job for item in second}
    finally:
        install_tier_detector(None)
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_deep_scan_downgrades_unless_startup_and_normal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CMC_QUOTA_PROFILE", "basic")
    get_settings.cache_clear()
    install_tier_detector(TierDetector())
    install_budget_controller(
        BudgetController(
            quota_profile="basic",
            monthly_budget=10_000,
            store=MemoryBudgetStore(),
            now=lambda: NOW,
        )
    )
    deps, _evidence = research_deps()
    calls: list[dict[str, object]] = []
    original = deps.gateway.fetch

    async def _fetch(endpoint: str, params: dict[str, object], *args: object, **kwargs: object):
        if endpoint == "/v1/cryptocurrency/listings/latest":
            calls.append(dict(params))
            page = [
                {"id": index, "symbol": f"C{index}", "quote": {"USD": {}}} for index in range(200)
            ]
            return (
                {"data": page, "status": {"error_code": 0, "credit_count": 1}},
                FetchMeta(
                    data_mode="LIVE",
                    freshness="FRESH",
                    cache_hit=False,
                    credit_cost=1,
                    source_timestamp=None,
                    retrieved_at=NOW,
                    credit_status="known",
                ),
            )
        return await original(endpoint, params, *args, **kwargs)

    deps.gateway.fetch = _fetch  # type: ignore[method-assign]
    try:
        downgraded = await scan_market_movers(
            ScanMoversInput(deep_scan=True, universe_size=20),
            deps=deps,
        )
        assert len(calls) == 1
        assert any("downgraded" in note for note in downgraded.limitations)

        calls.clear()
        monkeypatch.setenv("CMC_QUOTA_PROFILE", "startup")
        get_settings.cache_clear()
        install_budget_controller(
            BudgetController(
                quota_profile="startup",
                monthly_budget=450_000,
                store=MemoryBudgetStore(),
                now=lambda: NOW,
            )
        )
        opened = await scan_market_movers(
            ScanMoversInput(deep_scan=True, universe_size=20),
            deps=deps,
        )
        assert [item["start"] for item in calls] == [1, 201, 401, 601, 801]
        assert any("paged listings up to 1000" in note for note in opened.limitations)

        calls.clear()
        byok = await scan_market_movers(
            ScanMoversInput(deep_scan=True, universe_size=20),
            override_cmc_key="caller-key",
            deps=deps,
        )
        assert len(calls) == 1
        assert any("caller-supplied key" in note for note in byok.limitations)
    finally:
        install_budget_controller(None)
        install_tier_detector(None)
        get_settings.cache_clear()
