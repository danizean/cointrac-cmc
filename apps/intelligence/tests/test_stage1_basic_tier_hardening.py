"""Tahap 1 — CoinMarketCap API & Basic Tier Hardening tests (18 mandatory scenarios)."""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.adapters.cache import StoredSnapshot, cache_key, ttl_for_endpoint
from app.adapters.cmc_client import CMCClient, CMCEndpointUnavailableError
from app.adapters.normalizer import SymbolResolution
from app.api.deps import (
    ApiKeyRecord,
    MemoryKeyDirectory,
    MemoryRateStore,
    install_keys,
    install_rate_store,
    key_hash,
)
from app.core.config import Settings, get_settings
from app.main import app, create_app
from app.quant.metrics import annualized_volatility, log_returns, utc_daily_close
from app.schemas.envelope import DataMode, EvidenceStatus, Freshness
from app.schemas.tools import (
    DerivativesAnalysisInput,
    HistoricalPerformanceInput,
    SectorRotationInput,
)
from app.services import intelligence
from app.services.budget import (
    BudgetController,
    MemoryBudgetStore,
    UsageEvent,
    evaluate_budget_state,
    install_budget_controller,
    reset_budget_controller,
)
from app.services.daily_closes import (
    DAILY_CLOSE_SOURCE,
    DailyCloseRow,
    MemoryDailyCloseStore,
    capture_daily_closes_from_listings,
)
from app.services.evidence import MemoryEvidence
from app.services.intelligence import (
    SectorBook,
    SectorDef,
    ServiceDeps,
    install_deps,
)
from app.services.warmer import BASIC_WARMER_JOBS, CacheWarmer

BASE = "https://pro-api.coinmarketcap.com"
NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)
SANDBOX = "ct_live_stage1_hardening_fixture_001"


class MemorySnapshotStore:
    def __init__(self, rows: dict[str, StoredSnapshot] | None = None) -> None:
        self.rows = dict(rows or {})
        self.upserts = 0

    async def get_by_key(self, key: str) -> StoredSnapshot | None:
        return self.rows.get(key)

    async def list_endpoint(self, endpoint: str) -> list[StoredSnapshot]:
        return [row for row in self.rows.values() if row.endpoint == endpoint]

    async def upsert(self, snapshot: StoredSnapshot) -> None:
        self.upserts += 1
        self.rows[snapshot.cache_key] = snapshot


class StaticAssets(intelligence.AssetBook):
    async def resolve(self, symbols: list[str]) -> SymbolResolution:
        table = {"BTC": 1, "ETH": 1027, "SOL": 5426, "AVAX": 5805}
        ids = {sym.upper(): table[sym.upper()] for sym in symbols if sym.upper() in table}
        return SymbolResolution(ids=ids, limitations=[])


class AllAllowedCapabilities(intelligence.CapabilityMap):
    def allows(self, endpoint: str, credential: str | None = None) -> bool:
        del endpoint, credential
        return True


class StaticCategorySectors(SectorBook):
    async def load(self) -> list[SectorDef]:
        return [
            SectorDef("defi", "DeFi", "6051a82066fc1b42617d6dc0", ("defi",)),
        ]


async def _noop_sleep(_seconds: float) -> None:
    return None


def _ok_status(credits: int = 1, ts: str = "2026-11-24T11:59:00.000Z") -> dict[str, object]:
    return {
        "timestamp": ts,
        "error_code": 0,
        "error_message": None,
        "credit_count": credits,
    }


def _listings_payload(credits: int = 1) -> dict[str, object]:
    coins = [
        (1, "BTC", "Bitcoin", 90000.0, 1.8e12, 4.0e10, 1.5, 4.0, ["layer-1"]),
        (1027, "ETH", "Ethereum", 3200.0, 3.8e11, 2.2e10, 2.2, 6.0, ["layer-1"]),
        (5426, "SOL", "Solana", 180.0, 8.5e10, 7.5e9, 4.5, 11.0, ["layer-1", "defi"]),
        (7278, "AAVE", "Aave", 210.0, 3.2e9, 4.0e8, 3.2, 8.0, ["defi"]),
        (7083, "UNI", "Uniswap", 11.5, 6.9e9, 5.1e8, 2.5, 7.0, ["defi"]),
        (1518, "MKR", "Maker", 1900.0, 1.7e9, 1.9e8, 1.8, 5.0, ["defi"]),
        (5692, "COMP", "Compound", 72.0, 6.2e8, 8.0e7, 1.1, 3.0, ["defi"]),
        (6538, "CRV", "Curve", 0.55, 6.8e8, 1.4e8, 2.9, 6.5, ["defi"]),
    ]
    rows = []
    for idx, (cid, sym, name, price, mcap, vol, c24, c7, tags) in enumerate(coins, start=1):
        rows.append(
            {
                "id": cid,
                "symbol": sym,
                "name": name,
                "cmc_rank": idx,
                "tags": tags,
                "quote": {
                    "USD": {
                        "price": price,
                        "market_cap": mcap,
                        "volume_24h": vol,
                        "percent_change_24h": c24,
                        "percent_change_7d": c7,
                        "percent_change_30d": c7 * 1.5,
                        "percent_change_60d": c7 * 2.0,
                    }
                },
            }
        )
    return {"data": rows, "status": _ok_status(credits)}


def _global_latest_payload(credits: int = 1) -> dict[str, object]:
    return {
        "data": {
            "btc_dominance": 55.0,
            "eth_dominance": 15.0,
            "btc_dominance_24h_percentage_change": -0.25,
            "quote": {
                "USD": {
                    "total_market_cap": 3_000_000_000_000.0,
                    "total_volume_24h": 140_000_000_000.0,
                    "total_market_cap_yesterday_percentage_change": 2.1,
                }
            },
        },
        "status": _ok_status(credits),
    }


def _fear_latest_payload(credits: int = 1) -> dict[str, object]:
    return {
        "data": {"value": 62, "value_classification": "Greed"},
        "status": _ok_status(credits),
    }


def _global_historical_payload(days: int = 31, credits: int = 1) -> dict[str, object]:
    start = NOW - timedelta(days=days - 1)
    quotes = []
    for i in range(days):
        ts = (start + timedelta(days=i)).strftime("%Y-%m-%dT00:00:00.000Z")
        mcap = 2_500_000_000_000.0 * (1.0 + 0.005 * i)
        dom = 52.0 + 0.1 * i
        quotes.append(
            {
                "timestamp": ts,
                "btc_dominance": round(dom, 4),
                "quote": {"USD": {"total_market_cap": round(mcap, 2)}},
            }
        )
    return {"data": {"quotes": quotes}, "status": _ok_status(credits)}


def _fear_historical_payload(days: int = 31, credits: int = 1) -> dict[str, object]:
    start = NOW - timedelta(days=days - 1)
    rows = []
    for i in range(days):
        ts = str(int((start + timedelta(days=i)).timestamp()))
        rows.append(
            {
                "timestamp": ts,
                "value": 40 + i,
                "value_classification": "Neutral" if 40 + i < 55 else "Greed",
            }
        )
    return {"data": rows, "status": _ok_status(credits)}


async def _seed_warehouse_series(
    store: MemoryDailyCloseStore,
    cmc_id: int,
    days: int,
    *,
    base_price: float,
    step_wave: float,
    end_date: date = date(2026, 11, 24),
) -> list[DailyCloseRow]:
    rows: list[DailyCloseRow] = []
    start = end_date - timedelta(days=days - 1)
    price = base_price
    for i in range(days):
        day = start + timedelta(days=i)
        pct = step_wave if i % 2 == 0 else -(step_wave * 0.45)
        price = round(price * (1.0 + pct), 6)
        rows.append(
            DailyCloseRow(
                cmc_id=cmc_id,
                utc_date=day,
                close_price=price,
                market_cap=price * 1_000_000.0,
                volume_24h=price * 100_000.0,
                source=DAILY_CLOSE_SOURCE,
                observed_at=datetime(day.year, day.month, day.day, 23, 55, tzinfo=UTC),
            )
        )
    await store.upsert_many(rows)
    return rows


# ---------------------------------------------------------------------------
# Tests 1 & 2: Quota profiles (startup, basic, adaptive) & default TTL multipliers
# ---------------------------------------------------------------------------
def test_01_quota_profiles_and_startup_validation() -> None:
    startup = Settings(_env_file=None, cmc_quota_profile="startup")
    basic = Settings(_env_file=None, cmc_quota_profile="BASIC")  # type: ignore[arg-type]
    adaptive = Settings(_env_file=None, cmc_quota_profile=" adaptive ")  # type: ignore[arg-type]

    assert startup.cmc_quota_profile == "startup"
    assert basic.cmc_quota_profile == "basic"
    assert adaptive.cmc_quota_profile == "adaptive"
    assert startup.resolved_monthly_credit_budget() == 450_000
    assert basic.resolved_monthly_credit_budget() == 10_000
    assert adaptive.resolved_monthly_credit_budget() == 10_000

    with pytest.raises(ValidationError):
        Settings(_env_file=None, cmc_quota_profile="enterprise")  # type: ignore[arg-type]


def test_02_default_ttl_multipliers_per_profile_and_override() -> None:
    startup = Settings(_env_file=None, cmc_quota_profile="startup")
    basic = Settings(_env_file=None, cmc_quota_profile="basic")
    adaptive = Settings(_env_file=None, cmc_quota_profile="adaptive")
    explicit = Settings(_env_file=None, cmc_quota_profile="basic", cmc_cache_ttl_multiplier=4.0)

    assert startup.resolved_ttl_multiplier("NORMAL") == 1.0
    assert basic.resolved_ttl_multiplier("NORMAL") == 2.5
    assert adaptive.resolved_ttl_multiplier("NORMAL", warning_level="NONE") == 1.0
    assert adaptive.resolved_ttl_multiplier("NORMAL", warning_level="ELEVATED") == 1.5
    assert adaptive.resolved_ttl_multiplier("CONSERVATION") == 2.5
    assert adaptive.resolved_ttl_multiplier("EMERGENCY") == 5.0
    assert adaptive.resolved_ttl_multiplier("CUTOFF") == 12.0
    assert explicit.resolved_ttl_multiplier("NORMAL") == 4.0


# ---------------------------------------------------------------------------
# Test 3: Budget state machine exact transitions at 70%, 85%, 95%, and 100%
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_03_budget_state_machine_exact_thresholds_and_telemetry() -> None:
    # Exact boundary verification across 10,000-credit Basic budget
    assert evaluate_budget_state(6_999, 10_000)[:2] == ("NORMAL", "NONE")
    assert evaluate_budget_state(7_000, 10_000)[:2] == ("NORMAL", "ELEVATED")
    assert evaluate_budget_state(8_499, 10_000)[:2] == ("NORMAL", "ELEVATED")
    assert evaluate_budget_state(8_500, 10_000)[:2] == ("CONSERVATION", "CONSERVATION")
    assert evaluate_budget_state(9_499, 10_000)[:2] == ("CONSERVATION", "CONSERVATION")
    assert evaluate_budget_state(9_500, 10_000)[:2] == ("EMERGENCY", "EMERGENCY")
    assert evaluate_budget_state(9_999, 10_000)[:2] == ("EMERGENCY", "EMERGENCY")
    assert evaluate_budget_state(10_000, 10_000)[:2] == ("CUTOFF", "CUTOFF")
    assert evaluate_budget_state(10_500, 10_000)[:2] == ("CUTOFF", "CUTOFF")

    # Verify policy enforcement across states
    budget_cons = BudgetController(
        quota_profile="adaptive",
        monthly_budget=10_000,
        store=MemoryBudgetStore([UsageEvent("/v1/a", 8_500, created_at=NOW)]),
        now=lambda: NOW,
    )
    cons_expensive = await budget_cons.check_upstream_allowed("/v1/cryptocurrency/category")
    cons_standard = await budget_cons.check_upstream_allowed("/v1/cryptocurrency/listings/latest")
    assert cons_expensive.state == "CONSERVATION"
    assert cons_expensive.allowed is False
    assert cons_standard.allowed is True
    assert cons_standard.ttl_multiplier == 2.5

    budget_emerg = BudgetController(
        quota_profile="adaptive",
        monthly_budget=10_000,
        store=MemoryBudgetStore([UsageEvent("/v1/a", 9_500, created_at=NOW)]),
        now=lambda: NOW,
    )
    emerg_user = await budget_emerg.check_upstream_allowed("/v1/cryptocurrency/listings/latest")
    emerg_warmer = await budget_emerg.check_upstream_allowed(
        "/v1/cryptocurrency/listings/latest", priority="core_warmer"
    )
    assert emerg_user.state == "EMERGENCY"
    assert emerg_user.allowed is False
    assert emerg_warmer.allowed is True
    assert emerg_warmer.ttl_multiplier == 5.0

    budget_cut = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=MemoryBudgetStore([UsageEvent("/v1/a", 10_000, created_at=NOW)]),
        now=lambda: NOW,
    )
    cut_warmer = await budget_cut.check_upstream_allowed(
        "/v1/cryptocurrency/listings/latest", priority="core_warmer"
    )
    assert cut_warmer.state == "CUTOFF"
    assert cut_warmer.allowed is False

    # Existing telemetry endpoints surface budget summary and state
    install_budget_controller(budget_cons)
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="sandbox",
                    key_hash=key_hash(SANDBOX),
                    rate_limit_per_min=30,
                    is_active=True,
                )
            ]
        )
    )
    install_rate_store(MemoryRateStore())
    try:
        client = TestClient(app)
        summary_res = client.get("/v1/telemetry/summary", headers={"x-cointrac-key": SANDBOX})
        usage_res = client.get("/v1/telemetry/usage", headers={"x-cointrac-key": SANDBOX})
    finally:
        reset_budget_controller()

    assert summary_res.status_code == 200
    assert "cmc_budget" not in summary_res.json()
    assert usage_res.status_code == 200
    assert "cmc_budget" not in usage_res.json()
    direct = await budget_cons.snapshot()
    assert direct.state == "CONSERVATION"
    assert direct.credits_used_this_month == 8_500


# ---------------------------------------------------------------------------
# Tests 4 & 5: Credit recording from status.credit_count & zero recording on cache hit
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_04_and_05_credit_cost_from_status_and_cache_hits_record_zero() -> None:
    usage_store = MemoryBudgetStore()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=usage_store,
        now=lambda: NOW,
    )
    snap_store = MemorySnapshotStore()
    url = f"{BASE}/v1/cryptocurrency/listings/latest"
    params: dict[str, object] = {"start": 1, "limit": 200, "convert": "USD"}

    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(
            return_value=httpx.Response(200, json=_listings_payload(credits=3))
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=snap_store,
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as client:
            _, first = await client.fetch("/v1/cryptocurrency/listings/latest", params)
            # L1 cache hit
            _, l1_hit = await client.fetch("/v1/cryptocurrency/listings/latest", params)
        # Fresh CMCClient with empty L1 hits L2 snapshot cache
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=snap_store,
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as client2:
            _, l2_hit = await client2.fetch("/v1/cryptocurrency/listings/latest", params)

    assert route.call_count == 1
    assert first.credit_cost == 3
    assert l1_hit.cache_hit is True and l1_hit.credit_cost == 0
    assert l2_hit.cache_hit is True and l2_hit.credit_cost == 0
    # Only the single real upstream call was recorded with exact status.credit_count=3
    assert len(usage_store.events) == 1
    assert usage_store.events[0].credit_cost == 3
    assert usage_store.events[0].cache_status == "MISS"
    snap = await budget.snapshot()
    assert snap.credits_used_this_month == 3
    assert snap.upstream_calls_this_month == 1


# ---------------------------------------------------------------------------
# Tests 6 & 7: BYOK excluded from server-key budget & BYOK stays subject to per-user rate limit
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_06_byok_excluded_from_server_budget_and_survives_cutoff() -> None:
    usage_store = MemoryBudgetStore([UsageEvent("/v1/prior", 10_000, created_at=NOW)])
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=usage_store,
        now=lambda: NOW,
    )
    snap_store = MemorySnapshotStore()
    url = f"{BASE}/v2/cryptocurrency/quotes/latest"

    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(
            return_value=httpx.Response(
                200,
                json={"data": {"1": {"id": 1, "symbol": "BTC"}}, "status": _ok_status(credits=2)},
            )
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=snap_store,
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as client:
            # Server-key call blocked at CUTOFF (zero upstream calls)
            with pytest.raises(CMCEndpointUnavailableError):
                await client.fetch("/v2/cryptocurrency/quotes/latest", {"id": "1"})
            assert route.call_count == 0

            # BYOK call STILL works during server CUTOFF and does NOT record into server budget
            payload, meta = await client.fetch(
                "/v2/cryptocurrency/quotes/latest",
                {"id": "1"},
                override_api_key="caller_owned_byok_key_12345",
            )

    assert route.call_count == 1
    assert payload["data"] == {"1": {"id": 1, "symbol": "BTC"}}
    assert meta.data_mode == "LIVE"
    assert meta.credit_cost == 2
    assert len(usage_store.events) == 1
    assert (await budget.snapshot()).credits_used_this_month == 10_000


def test_07_byok_remains_subject_to_per_user_rate_limit() -> None:
    from tests.test_services import Book, Caps, Scripted, common_handlers

    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="byok-user",
                    key_hash=key_hash(SANDBOX),
                    rate_limit_per_min=1,
                    is_active=True,
                    user_id="11111111-1111-4111-8111-111111111111",
                )
            ]
        )
    )
    install_rate_store(MemoryRateStore())
    install_deps(
        ServiceDeps(
            gateway=Scripted(common_handlers()),
            evidence=MemoryEvidence(),
            assets=Book(),
            sectors=SectorBook(),
            capabilities=Caps(),
            now=lambda: NOW,
        )
    )
    headers = {
        "x-cointrac-key": SANDBOX,
        "x-cmc-api-key": "caller_owned_byok_key_99999",
    }
    try:
        api = TestClient(app)
        first = api.get("/v1/intelligence/market-overview", headers=headers)
        second = api.get("/v1/intelligence/market-overview", headers=headers)
    finally:
        install_deps(None)

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers["retry-after"]


# ---------------------------------------------------------------------------
# Tests 8 & 9: Warmer respects CUTOFF & never creates duplicate background tasks
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_08_warmer_respects_cutoff() -> None:
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=MemoryBudgetStore([UsageEvent("/v1/prior", 10_000, created_at=NOW)]),
        now=lambda: NOW,
    )
    with respx.mock(assert_all_called=False) as router:
        routes = [
            router.get(f"{BASE}{job.endpoint}").mock(
                return_value=httpx.Response(200, json={"data": {}, "status": _ok_status(1)})
            )
            for job in BASIC_WARMER_JOBS
        ]
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as client:
            warmer = CacheWarmer(client, budget_controller=budget, now=lambda: NOW)
            results = await warmer.run_once()

    assert len(results) == 1
    assert results[0].outcome == "skipped_cutoff"
    assert all(r.call_count == 0 for r in routes)


@pytest.mark.asyncio
async def test_09_warmer_prevents_duplicate_tasks_on_repeated_start() -> None:
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=MemoryBudgetStore([UsageEvent("/v1/prior", 10_000, created_at=NOW)]),
        now=lambda: NOW,
    )
    async with CMCClient(
        api_key="server-key",
        base_url=BASE,
        snapshot_store=MemorySnapshotStore(),
        budget_controller=budget,
        simulate_basic_tier=False,
        sleep=_noop_sleep,
        now=lambda: NOW,
    ) as client:
        warmer = CacheWarmer(
            client,
            budget_controller=budget,
            tick_seconds=60.0,
            now=lambda: NOW,
        )
        first_started = warmer.start()
        first_task = warmer.active_task
        second_started = warmer.start()
        second_task = warmer.active_task
        try:
            assert first_started is True
            assert second_started is False
            assert first_task is not None
            assert second_task is first_task
            assert warmer.start_count == 1
        finally:
            await warmer.stop()
        assert warmer.is_running is False


# ---------------------------------------------------------------------------
# Tests 10 & 11: daily_asset_closes capture with zero CMC calls & idempotency
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_10_and_11_daily_closes_idempotent_zero_cmc_calls() -> None:
    params: dict[str, object] = {"start": 1, "limit": 200, "convert": "USD"}
    endpoint = "/v1/cryptocurrency/listings/latest"
    snap = StoredSnapshot(
        cache_key=cache_key(endpoint, params),
        endpoint=endpoint,
        params_json=params,
        payload=_listings_payload(),
        source_timestamp=NOW - timedelta(minutes=2),
        retrieved_at=NOW - timedelta(minutes=1),
        ttl_seconds=300,
        credit_cost=1,
        is_verified_fallback=True,
    )
    snap_store = MemorySnapshotStore({snap.cache_key: snap})
    close_store = MemoryDailyCloseStore()

    with respx.mock(assert_all_called=False) as router:
        route = router.get(f"{BASE}{endpoint}").mock(
            return_value=httpx.Response(200, json=_listings_payload())
        )
        first = await capture_daily_closes_from_listings(
            snapshot_store=snap_store,
            close_store=close_store,
            now=NOW,
        )
        second = await capture_daily_closes_from_listings(
            snapshot_store=snap_store,
            close_store=close_store,
            now=NOW,
        )

    assert route.call_count == 0
    assert first.used_existing_snapshot is True
    assert first.rows_written == 8
    assert first.skipped_existing_date is False
    assert second.rows_written == 0
    assert second.skipped_existing_date is True
    # Strictly idempotent on (cmc_id, utc_date)
    assert len(close_store.all_rows) == 8
    btc_rows = await close_store.list_asset_closes(1)
    assert len(btc_rows) == 1
    assert btc_rows[0].cmc_id == 1
    assert btc_rows[0].utc_date == NOW.date()
    assert btc_rows[0].close_price == 90000.0
    assert btc_rows[0].source == DAILY_CLOSE_SOURCE


# ---------------------------------------------------------------------------
# Tests 12, 13 & 14: Historical performance warehouse (>=30d vs <30d) & EvidenceEnvelope disclosure
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_12_and_14_historical_performance_uses_warehouse_after_30_days_and_discloses() -> (
    None
):
    close_store = MemoryDailyCloseStore()
    sol_rows = await _seed_warehouse_series(close_store, 5426, 30, base_price=150.0, step_wave=0.04)
    await _seed_warehouse_series(close_store, 1, 30, base_price=85000.0, step_wave=0.02)

    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}/v2/cryptocurrency/ohlcv/historical").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as gateway:
            deps = ServiceDeps(
                gateway=gateway,
                evidence=MemoryEvidence(),
                assets=StaticAssets(),
                sectors=SectorBook(),
                capabilities=AllAllowedCapabilities(),
                now=lambda: NOW,
                daily_closes=close_store,
            )
            result = await intelligence.get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL", count=30),
                deps=deps,
            )

    expected_series = utc_daily_close(
        [
            (datetime(r.utc_date.year, r.utc_date.month, r.utc_date.day, tzinfo=UTC), r.close_price)
            for r in sol_rows
        ]
    )
    expected_vol = annualized_volatility(log_returns(expected_series))

    assert result.status == EvidenceStatus.PARTIAL
    assert result.evidence.data_mode == DataMode.VERIFIED_SNAPSHOT_FALLBACK
    assert result.methodology.annualization_basis == "365d"
    assert result.data.overlap_days == 30
    assert result.data.annualized_volatility == pytest.approx(expected_vol)
    assert result.data.max_drawdown is not None and result.data.max_drawdown <= 0
    assert result.data.beta_vs_btc is not None and math.isfinite(result.data.beta_vs_btc)
    assert result.data.correlation_vs_btc is not None
    # Explicit disclosure in methodology & EvidenceEnvelope limitations
    assert "daily_asset_closes" in result.methodology.observation_window
    assert "not official CMC OHLCV" in result.methodology.observation_window
    assert "daily_asset_closes_observed_reference" in result.methodology.metrics
    assert any(
        "daily_asset_closes" in note and "not official coinmarketcap ohlcv" in note.lower()
        for note in result.limitations
    )


@pytest.mark.asyncio
async def test_13_historical_performance_keeps_fallback_before_30_days() -> None:
    close_store = MemoryDailyCloseStore()
    await _seed_warehouse_series(close_store, 5426, 29, base_price=150.0, step_wave=0.04)
    await _seed_warehouse_series(close_store, 1, 29, base_price=85000.0, step_wave=0.02)

    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}/v2/cryptocurrency/ohlcv/historical").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as gateway:
            deps = ServiceDeps(
                gateway=gateway,
                evidence=MemoryEvidence(),
                assets=StaticAssets(),
                sectors=SectorBook(),
                capabilities=AllAllowedCapabilities(),
                now=lambda: NOW,
                daily_closes=close_store,
            )
            result = await intelligence.get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL", count=30),
                deps=deps,
            )

    assert result.status == EvidenceStatus.TIER_RESTRICTED
    assert result.data.annualized_volatility is None
    assert result.data.max_drawdown is None
    assert result.data.beta_vs_btc is None
    assert result.data.correlation_vs_btc is None
    assert any("29" in note and "30" in note for note in result.limitations)


# ---------------------------------------------------------------------------
# Test 15: Historical global metrics & fear-and-greed use 24h TTL cache
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_15_historical_global_and_fear_greed_use_24h_ttl_and_enrich_workflows() -> None:
    assert ttl_for_endpoint("/v1/global-metrics/quotes/historical") == 86400
    assert ttl_for_endpoint("/v3/fear-and-greed/historical") == 86400

    clock = [NOW]
    snap_store = MemorySnapshotStore()
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}/v1/global-metrics/quotes/latest").mock(
            return_value=httpx.Response(200, json=_global_latest_payload())
        )
        router.get(f"{BASE}/v3/fear-and-greed/latest").mock(
            return_value=httpx.Response(200, json=_fear_latest_payload())
        )
        router.get(f"{BASE}/v1/cryptocurrency/listings/latest").mock(
            return_value=httpx.Response(200, json=_listings_payload())
        )
        gh_route = router.get(f"{BASE}/v1/global-metrics/quotes/historical").mock(
            return_value=httpx.Response(200, json=_global_historical_payload())
        )
        fh_route = router.get(f"{BASE}/v3/fear-and-greed/historical").mock(
            return_value=httpx.Response(200, json=_fear_historical_payload())
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=snap_store,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: clock[0],
        ) as gateway:
            deps = ServiceDeps(
                gateway=gateway,
                evidence=MemoryEvidence(),
                assets=StaticAssets(),
                sectors=SectorBook(),
                capabilities=AllAllowedCapabilities(),
                now=lambda: clock[0],
            )
            overview = await intelligence.get_market_overview(deps=deps)
            # Advance 12 hours (< 24h): historical endpoints MUST still be cache hits!
            clock[0] = NOW + timedelta(hours=12)
            regime = await intelligence.analyze_market_regime(deps=deps)
            # Advance past 24 hours: historical endpoints refresh
            clock[0] = NOW + timedelta(hours=24, seconds=5)
            overview_after_24h = await intelligence.get_market_overview(deps=deps)

    assert overview.status == EvidenceStatus.OK
    assert overview.data.total_market_cap_change_7d_pct is not None
    assert overview.data.total_market_cap_change_30d_pct is not None
    assert overview.data.btc_dominance_change_7d is not None
    assert overview.data.fear_greed_avg_7d is not None
    assert overview.data.fear_greed_avg_30d is not None
    assert regime.status == EvidenceStatus.OK
    assert regime.data.total_market_cap_change_7d_pct is not None
    assert regime.data.fear_greed_avg_30d is not None
    assert overview_after_24h.status == EvidenceStatus.OK
    # 1st call at t=0, cached at t=12h, refreshed at t=24h+5s => exactly 2 HTTP calls each
    assert gh_route.call_count == 2
    assert fh_route.call_count == 2


# ---------------------------------------------------------------------------
# Test 16: Sector rotation 403 degradation to verified snapshot fallback
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_16_sector_403_degrades_to_verified_snapshot_fallback() -> None:
    cat_params: dict[str, object] = {
        "id": "6051a82066fc1b42617d6dc0",
        "limit": 100,
        "convert": "USD",
    }
    retrieved = NOW - timedelta(hours=6)
    cat_payload = {
        "data": {"id": "6051a82066fc1b42617d6dc0", "coins": _listings_payload()["data"][2:]},
        "status": _ok_status(1, ts=retrieved.strftime("%Y-%m-%dT%H:%M:%SZ")),
    }
    snap = StoredSnapshot(
        cache_key=cache_key("/v1/cryptocurrency/category", cat_params),
        endpoint="/v1/cryptocurrency/category",
        params_json=cat_params,
        payload=cat_payload,
        source_timestamp=retrieved,
        retrieved_at=retrieved,
        ttl_seconds=900,
        credit_cost=1,
        is_verified_fallback=True,
    )
    snap_store = MemorySnapshotStore({snap.cache_key: snap})

    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}/v1/cryptocurrency/listings/latest").mock(
            return_value=httpx.Response(200, json=_listings_payload())
        )
        router.get(f"{BASE}/v1/cryptocurrency/category").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=snap_store,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as gateway:
            deps = ServiceDeps(
                gateway=gateway,
                evidence=MemoryEvidence(),
                assets=StaticAssets(),
                sectors=StaticCategorySectors(),
                capabilities=AllAllowedCapabilities(),
                now=lambda: NOW,
            )
            result = await intelligence.analyze_sector_rotation(
                SectorRotationInput(sectors=["defi"]),
                deps=deps,
            )

    assert result.evidence.data_mode == DataMode.VERIFIED_SNAPSHOT_FALLBACK
    assert result.evidence.freshness == Freshness.AGING
    assert result.status == EvidenceStatus.PARTIAL
    assert result.data.sectors[0].taxonomy_source == "cmc_category"
    assert any("verified snapshot" in note.lower() for note in result.limitations)


# ---------------------------------------------------------------------------
# Test 17: Derivatives 403 degradation to verified snapshot fallback
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_17_derivatives_403_degrades_to_verified_snapshot_fallback() -> None:
    deriv_endpoint = "/v5/cryptocurrency/derivatives/market-pairs/list/latest"
    deriv_params: dict[str, object] = {"crypto_id": 1, "limit": 25}
    retrieved = NOW - timedelta(hours=30)
    deriv_payload: dict[str, object] = {
        "data": {
            "funding_rate": 0.0085,
            "open_interest": 12_500_000_000.0,
            "liquidations_24h": 45_000_000.0,
            "market_pairs": [{}, {}],
        },
        "status": _ok_status(1, ts=retrieved.strftime("%Y-%m-%dT%H:%M:%SZ")),
    }
    snap = StoredSnapshot(
        cache_key=cache_key(deriv_endpoint, deriv_params),
        endpoint=deriv_endpoint,
        params_json=deriv_params,
        payload=deriv_payload,
        source_timestamp=retrieved,
        retrieved_at=retrieved,
        ttl_seconds=300,
        credit_cost=1,
        is_verified_fallback=True,
    )
    snap_store = MemorySnapshotStore({snap.cache_key: snap})

    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}{deriv_endpoint}").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        )
        router.get(f"{BASE}/v5/derivatives/liquidations/quotes/latest").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        )
        router.get(f"{BASE}/v5/exchange/derivatives/list").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=snap_store,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as gateway:
            deps = ServiceDeps(
                gateway=gateway,
                evidence=MemoryEvidence(),
                assets=StaticAssets(),
                sectors=SectorBook(),
                capabilities=AllAllowedCapabilities(),
                now=lambda: NOW,
            )
            result = await intelligence.analyze_derivatives(
                DerivativesAnalysisInput(symbol="BTC"),
                deps=deps,
            )

    assert result.evidence.data_mode == DataMode.VERIFIED_SNAPSHOT_FALLBACK
    assert result.evidence.freshness == Freshness.STALE
    # Never falsely upgraded to OK on 403 verified snapshot fallback
    assert result.status == EvidenceStatus.PARTIAL
    assert result.data.mode == "derivatives"
    assert result.data.open_interest == 12_500_000_000.0
    assert any("verified snapshot" in note.lower() for note in result.limitations)


# ---------------------------------------------------------------------------
# Test 18: Warmer failure never breaks FastAPI startup or API responses
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_18_warmer_failure_never_breaks_startup_or_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1. Job-level failures inside run_once() are isolated and never raise
    with respx.mock(assert_all_called=False) as router:
        for job in BASIC_WARMER_JOBS:
            router.get(f"{BASE}{job.endpoint}").mock(
                side_effect=httpx.ConnectError("upstream down")
            )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as client:
            warmer = CacheWarmer(client, now=lambda: NOW)
            results = await warmer.run_once()
    assert len(results) >= len(BASIC_WARMER_JOBS)
    assert {item.job for item in results} >= {job.name for job in BASIC_WARMER_JOBS}
    assert all(r.outcome == "error" for r in results)

    # 2. Even if warmer.start() raises during FastAPI lifespan startup, /health stays 200 OK
    monkeypatch.setenv("CMC_WARMER_ENABLED", "true")
    get_settings.cache_clear()

    def boom_start(self: CacheWarmer) -> bool:
        raise RuntimeError("simulated warmer start crash")

    monkeypatch.setattr(CacheWarmer, "start", boom_start)
    try:
        test_app = create_app()
        with TestClient(test_app) as client:
            health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
    finally:
        get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Proposal SQL migration structural sanity verification
# ---------------------------------------------------------------------------
def test_proposal_migrations_008_and_009_structure() -> None:
    root = Path(__file__).resolve().parents[3]
    m008 = (root / "supabase" / "migrations" / "008_cmc_usage_budget.sql").read_text(
        encoding="utf-8"
    )
    m009 = (root / "supabase" / "migrations" / "009_daily_asset_closes.sql").read_text(
        encoding="utf-8"
    )

    for col in ("endpoint", "credit_cost", "cache_status", "error_category", "created_at"):
        assert col in m008
    assert "ENABLE ROW LEVEL SECURITY" in m008
    assert "FORCE ROW LEVEL SECURITY" in m008
    assert "REVOKE ALL ON TABLE public.cmc_usage FROM PUBLIC, anon, authenticated" in m008

    for col in ("cmc_id", "utc_date", "close_price", "market_cap", "volume_24h", "source"):
        assert col in m009
    assert "PRIMARY KEY (cmc_id, utc_date)" in m009
    assert "ENABLE ROW LEVEL SECURITY" in m009
    assert "FORCE ROW LEVEL SECURITY" in m009
    assert "REVOKE ALL ON TABLE public.daily_asset_closes FROM PUBLIC, anon, authenticated" in m009
