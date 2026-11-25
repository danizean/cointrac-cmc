"""Budget integrity: aggregation, reservation, retries, warmer, closes, telemetry.

SQLite tests open a real database file and aggregate with SUM and COUNT(*).
They are not a substitute for executing migration 010 on Postgres.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.adapters.cache import StoredSnapshot, cache_key
from app.adapters.cmc_client import CMCClient
from app.api.deps import (
    ApiKeyRecord,
    MemoryKeyDirectory,
    MemoryRateStore,
    install_keys,
    install_rate_store,
    key_hash,
)
from app.core.config import Settings
from app.main import app
from app.services.budget import (
    CORE_WARMER_ENDPOINTS,
    EXPENSIVE_ENDPOINTS,
    TOTALS_RPC,
    BudgetController,
    BudgetLedgerUnavailable,
    MemoryBudgetStore,
    SupabaseBudgetStore,
    UsageEvent,
)
from app.services.budget_sqlite import SqliteBudgetStore
from app.services.daily_closes import (
    DAILY_CLOSE_SOURCE,
    MemoryDailyCloseStore,
    capture_daily_closes_from_listings,
)
from app.services.warmer import (
    BASIC_WARMER_JOBS,
    CacheWarmer,
    projected_monthly_credits,
    warmer_credit_ceiling,
)

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)
BASE = "https://pro-api.coinmarketcap.com"
ROOT = Path(__file__).resolve().parents[3]


class MemorySnapshotStore:
    def __init__(self, rows: dict[str, StoredSnapshot] | None = None) -> None:
        self.rows = dict(rows or {})

    async def get_by_key(self, key: str) -> StoredSnapshot | None:
        return self.rows.get(key)

    async def list_endpoint(self, endpoint: str) -> list[StoredSnapshot]:
        return [row for row in self.rows.values() if row.endpoint == endpoint]

    async def upsert(self, snapshot: StoredSnapshot) -> None:
        self.rows[snapshot.cache_key] = snapshot


class DownLedger:
    async def monthly_totals(self, year: int, month: int) -> object:
        del year, month
        raise BudgetLedgerUnavailable("database unavailable")

    async def reserve(self, **kwargs: object) -> object:
        del kwargs
        raise BudgetLedgerUnavailable("database unavailable")

    async def reconcile(self, **kwargs: object) -> None:
        del kwargs
        raise BudgetLedgerUnavailable("database unavailable")


class AggregateOnlyClient:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def table(self, name: str) -> object:
        raise AssertionError(f"ledger must not page table {name}")

    def rpc(self, name: str, params: dict[str, object]) -> AggregateOnlyClient:
        self.calls.append(name)
        self._params = params
        return self

    def execute(self) -> SimpleNamespace:
        return SimpleNamespace(
            data=[
                {
                    "credits_committed": 1505,
                    "upstream_calls": 1505,
                    "warmer_credits": 0,
                    "billing_month_utc": "2026-11",
                }
            ]
        )


def _reserve_kwargs(key: str, *, budget: int = 10_000, caller: str = "user") -> dict[str, object]:
    return {
        "idempotency_key": key,
        "endpoint": "/v1/cryptocurrency/listings/latest",
        "reservation_credits": 1,
        "monthly_budget": budget,
        "priority": "standard",
        "cache_status": "MISS",
        "caller": caller,
        "attempt_no": 1,
        "quota_profile": "basic",
        "explicit_ttl_multiplier": None,
        "now": NOW,
    }


def test_warmer_stays_off_and_projected_cost_leaves_a_user_reserve() -> None:
    settings = Settings(_env_file=None, cmc_quota_profile="basic")
    assert settings.cmc_warmer_enabled is False
    ceiling = warmer_credit_ceiling(settings.resolved_monthly_credit_budget())
    assert ceiling == 4_000
    assert projected_monthly_credits() <= ceiling
    assert projected_monthly_credits() < 10_000


def test_supabase_store_uses_aggregate_rpc_not_a_row_page() -> None:
    client = AggregateOnlyClient()
    store = SupabaseBudgetStore(client)
    usage = asyncio.run(store.monthly_totals(2026, 11))
    assert client.calls == [TOTALS_RPC]
    assert usage.credits == 1505
    assert usage.calls == 1505


def test_sqlite_sum_counts_more_than_one_thousand_rows(tmp_path: Path) -> None:
    store = SqliteBudgetStore(tmp_path / "ledger.db")
    store.insert_known_rows(1505, 1, NOW)
    usage = store.monthly_totals_blocking(2026, 11)
    assert usage.credits == 1505
    assert usage.calls == 1505


@pytest.mark.asyncio
async def test_restart_reads_the_database_total(tmp_path: Path) -> None:
    path = tmp_path / "ledger.db"
    SqliteBudgetStore(path).insert_known_rows(1505, 2, NOW)
    reopened = SqliteBudgetStore(path)
    controller = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=reopened,
        now=lambda: NOW,
    )
    snap = await controller.snapshot()
    assert snap.ledger_status == "ok"
    assert snap.credits_used_this_month == 3010
    assert snap.upstream_calls_this_month == 1505


def test_two_workers_cannot_pass_a_one_credit_budget(tmp_path: Path) -> None:
    store = SqliteBudgetStore(tmp_path / "ledger.db")

    def once(index: int) -> bool:
        decision = store.reserve_blocking(**_reserve_kwargs(f"cmc:worker{index}", budget=1))
        return bool(decision.allowed)

    with ThreadPoolExecutor(max_workers=8) as pool:
        allowed = list(pool.map(once, range(24)))
    usage = store.monthly_totals_blocking(2026, 11)
    assert sum(allowed) == 1
    assert usage.credits == 1


def test_same_idempotency_key_does_not_reserve_twice(tmp_path: Path) -> None:
    store = SqliteBudgetStore(tmp_path / "ledger.db")
    kwargs = _reserve_kwargs("cmc:attempt-once")
    first = store.reserve_blocking(**kwargs)
    second = store.reserve_blocking(**kwargs)
    usage = store.monthly_totals_blocking(2026, 11)
    assert first.allowed is True
    assert second.allowed is True
    assert usage.credits == 1
    assert usage.calls == 1


@pytest.mark.asyncio
async def test_database_failure_fails_closed_without_reporting_zero() -> None:
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=DownLedger(),
        now=lambda: NOW,
    )
    snap = await budget.snapshot()
    decision = await budget.reserve_upstream(endpoint="/v1/cryptocurrency/listings/latest")
    assert snap.ledger_status == "unavailable"
    assert snap.state == "CUTOFF"
    assert snap.credits_used_this_month is None
    assert decision.allowed is False
    assert decision.ledger_status == "unavailable"


@pytest.mark.asyncio
async def test_retry_reconciles_each_attempt_and_unknown_is_not_zero() -> None:
    store = MemoryBudgetStore()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=store,
        now=lambda: NOW,
    )
    url = f"{BASE}/v1/cryptocurrency/listings/latest"

    async def _sleep(_seconds: float) -> None:
        return None

    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(
            side_effect=[
                httpx.Response(429, json={"status": {"error_code": 1008, "credit_count": 2}}),
                httpx.Response(200, json={"data": [], "status": {"error_code": 0}}),
            ]
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_sleep,
            now=lambda: NOW,
        ) as client:
            _payload, meta = await client.fetch(
                "/v1/cryptocurrency/listings/latest",
                {"start": 1, "limit": 200, "convert": "USD"},
            )
    assert route.call_count == 2
    assert meta.credit_status == "unknown"
    assert meta.credit_cost == 1
    assert [event.credit_cost for event in store.events] == [2, 1]
    assert [event.credit_status for event in store.events] == ["known", "unknown"]
    assert (await budget.snapshot()).credits_used_this_month == 3


@pytest.mark.asyncio
async def test_byok_and_cache_hit_do_not_consume_the_server_budget() -> None:
    store = MemoryBudgetStore()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=store,
        now=lambda: NOW,
    )
    url = f"{BASE}/v1/cryptocurrency/quotes/latest"

    async def _sleep(_seconds: float) -> None:
        return None

    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(
            return_value=httpx.Response(
                200,
                json={"data": {"1": {"id": 1}}, "status": {"error_code": 0, "credit_count": 4}},
            )
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_sleep,
            now=lambda: NOW,
        ) as client:
            await client.fetch(
                "/v1/cryptocurrency/quotes/latest",
                {"id": "1"},
                override_api_key="caller-owned-key",
            )
            _payload, meta = await client.fetch(
                "/v1/cryptocurrency/quotes/latest",
                {"id": "1"},
                override_api_key="caller-owned-key",
            )
    assert route.call_count == 2
    assert meta.credit_cost == 4
    assert store.events == []
    assert (await budget.snapshot()).credits_used_this_month == 0


@pytest.mark.asyncio
async def test_warmer_slows_in_conservation_and_stops_nonessential_in_emergency() -> None:
    conservation = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=MemoryBudgetStore([UsageEvent("/v1/prior", 8_500, created_at=NOW)]),
        now=lambda: NOW,
    )

    async def _sleep(_seconds: float) -> None:
        return None

    with respx.mock(assert_all_called=False) as router:
        routes = {
            job.name: router.get(f"{BASE}{job.endpoint}").mock(
                return_value=httpx.Response(
                    200, json={"data": {}, "status": {"error_code": 0, "credit_count": 1}}
                )
            )
            for job in BASIC_WARMER_JOBS
        }
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            budget_controller=conservation,
            simulate_basic_tier=False,
            sleep=_sleep,
            now=lambda: NOW,
        ) as client:
            warmer = CacheWarmer(client, budget_controller=conservation, now=lambda: NOW)
            first = await warmer.run_once()
            second = await warmer.run_once()
    assert any(item.outcome == "ok" for item in first)
    assert all(item.outcome == "skipped_not_due" for item in second)
    assert warmer.last_success
    assert routes["listings_top200"].call_count == 1

    emergency = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=MemoryBudgetStore([UsageEvent("/v1/prior", 9_600, created_at=NOW)]),
        now=lambda: NOW,
    )
    with respx.mock(assert_all_called=False) as router:
        for job in BASIC_WARMER_JOBS:
            router.get(f"{BASE}{job.endpoint}").mock(
                return_value=httpx.Response(
                    200, json={"data": {}, "status": {"error_code": 0, "credit_count": 1}}
                )
            )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            budget_controller=emergency,
            simulate_basic_tier=False,
            sleep=_sleep,
            now=lambda: NOW,
        ) as client:
            warmer = CacheWarmer(client, budget_controller=emergency, now=lambda: NOW)
            results = await warmer.run_once()
    by_job = {item.job: item.outcome for item in results}
    assert by_job["fear_and_greed"] == "skipped_emergency"
    assert by_job["asset_map"] == "skipped_emergency"
    assert by_job["listings_top200"] == "ok"


@pytest.mark.asyncio
async def test_failed_warmer_attempt_is_not_recorded_as_success() -> None:
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=MemoryBudgetStore(),
        now=lambda: NOW,
    )

    async def _sleep(_seconds: float) -> None:
        return None

    with respx.mock(assert_all_called=False):
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_sleep,
            now=lambda: NOW,
        ) as client:
            warmer = CacheWarmer(
                client,
                budget_controller=budget,
                jobs=BASIC_WARMER_JOBS[:1],
                now=lambda: NOW,
            )

            async def explode(
                *_args: object, **_kwargs: object
            ) -> tuple[dict[str, object], object]:
                raise RuntimeError("upstream failed")

            client.fetch = explode  # type: ignore[method-assign]
            results = await warmer.run_once()
    assert results[0].outcome == "error"
    assert "listings_top200" in warmer.last_attempt
    assert warmer.last_success == {}


@pytest.mark.asyncio
async def test_daily_close_keeps_the_first_utc_observation_and_accepts_late_data() -> None:
    params = {"start": 1, "limit": 200, "convert": "USD"}
    endpoint = "/v1/cryptocurrency/listings/latest"
    early = NOW - timedelta(minutes=30)
    late_source = datetime(2026, 11, 23, 23, 50, tzinfo=UTC)
    late_retrieved = datetime(2026, 11, 24, 0, 10, tzinfo=UTC)

    def payload(price: float, status_ts: datetime) -> dict[str, object]:
        return {
            "data": [
                {
                    "id": 1,
                    "quote": {
                        "USD": {
                            "price": price,
                            "market_cap": 10.0,
                            "volume_24h": 1.0,
                            "last_updated": status_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        }
                    },
                }
            ],
            "status": {
                "timestamp": status_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "error_code": 0,
                "credit_count": 1,
            },
        }

    first = StoredSnapshot(
        cache_key=cache_key(endpoint, params),
        endpoint=endpoint,
        params_json=params,
        payload=payload(90_000.0, early),
        source_timestamp=early,
        retrieved_at=early + timedelta(seconds=5),
        ttl_seconds=300,
        credit_cost=1,
        is_verified_fallback=True,
    )
    snapshots = MemorySnapshotStore({first.cache_key: first})
    closes = MemoryDailyCloseStore()
    opened = await capture_daily_closes_from_listings(
        snapshot_store=snapshots,
        close_store=closes,
        now=NOW,
    )
    first.payload.clear()
    first.payload.update(payload(10.0, early))
    repeated = await capture_daily_closes_from_listings(
        snapshot_store=snapshots,
        close_store=closes,
        now=NOW,
    )
    stored = await closes.list_asset_closes(1)
    assert opened.rows_written == 1
    assert repeated.rows_written == 0
    assert repeated.skipped_existing_date is True
    assert stored[0].close_price == 90_000.0
    assert stored[0].utc_date == early.date()
    assert stored[0].source_timestamp == early
    assert stored[0].retrieved_at == first.retrieved_at
    assert stored[0].source == DAILY_CLOSE_SOURCE
    assert "ohlcv" not in stored[0].source

    late = StoredSnapshot(
        cache_key="late-listings",
        endpoint=endpoint,
        params_json=params,
        payload=payload(80_000.0, late_source),
        source_timestamp=late_source,
        retrieved_at=late_retrieved,
        ttl_seconds=300,
        credit_cost=1,
        is_verified_fallback=True,
    )
    late_store = MemorySnapshotStore({late.cache_key: late})
    late_closes = MemoryDailyCloseStore()
    captured = await capture_daily_closes_from_listings(
        snapshot_store=late_store,
        close_store=late_closes,
        now=late_retrieved,
    )
    late_rows = await late_closes.list_asset_closes(1)
    assert captured.utc_date.isoformat() == "2026-11-23"
    assert late_rows[0].utc_date.isoformat() == "2026-11-23"
    assert late_rows[0].close_price == 80_000.0
    assert await late_closes.has_date(late_rows[0].utc_date) is True


def test_telemetry_does_not_publish_the_global_server_budget() -> None:
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=MemoryBudgetStore([UsageEvent("/v1/prior", 8_500, created_at=NOW)]),
        now=lambda: NOW,
    )
    from app.services.budget import install_budget_controller, reset_budget_controller

    install_budget_controller(budget)
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="reader",
                    key_hash=key_hash("ct_live_budget_privacy_fixture"),
                    rate_limit_per_min=30,
                    is_active=True,
                )
            ]
        )
    )
    install_rate_store(MemoryRateStore())
    try:
        client = TestClient(app)
        summary = client.get(
            "/v1/telemetry/summary",
            headers={"x-cointrac-key": "ct_live_budget_privacy_fixture"},
        )
        usage = client.get(
            "/v1/telemetry/usage",
            headers={"x-cointrac-key": "ct_live_budget_privacy_fixture"},
        )
    finally:
        reset_budget_controller()
    assert summary.status_code == 200
    assert usage.status_code == 200
    blob = str(summary.json()) + str(usage.json())
    assert "cmc_budget" not in blob
    assert "credits_used_this_month" not in blob
    assert "8500" not in blob


def test_migration_010_and_011_are_locked_aggregate_proposals() -> None:
    migration = (ROOT / "supabase" / "migrations" / "010_cmc_budget_integrity.sql").read_text(
        encoding="utf-8"
    )
    closes = (ROOT / "supabase" / "migrations" / "011_daily_asset_closes_immutable.sql").read_text(
        encoding="utf-8"
    )
    assert "SUM(" in migration
    assert "COUNT(*)" in migration
    assert "pg_advisory_xact_lock" in migration
    assert "REVOKE INSERT, UPDATE, DELETE ON TABLE public.cmc_usage FROM service_role" in migration
    assert "GRANT EXECUTE ON FUNCTION public.cointrac_reserve_cmc_credit" in migration
    for endpoint in CORE_WARMER_ENDPOINTS | EXPENSIVE_ENDPOINTS:
        assert endpoint in migration
    assert "DO NOT APPLY" in migration
    assert "BEFORE UPDATE" in closes
    assert "daily_asset_closes observations are immutable" in closes
    assert "REVOKE UPDATE ON TABLE public.daily_asset_closes FROM service_role" in closes
    assert "DO NOT APPLY" in closes
