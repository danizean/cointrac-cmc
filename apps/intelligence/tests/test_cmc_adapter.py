from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import respx

from app.adapters.cache import StoredSnapshot, cache_key, ttl_for_endpoint
from app.adapters.cmc_client import (
    CMCClient,
    CMCEndpointUnavailableError,
    SupabaseSnapshotStore,
)
from app.adapters.normalizer import resolve_symbols_to_ids

BASE = "https://pro-api.coinmarketcap.com"
QUOTES = "/v2/cryptocurrency/quotes/latest"
OHLCV = "/v2/cryptocurrency/ohlcv/historical"
NOW = datetime(2026, 11, 22, 15, 0, tzinfo=UTC)


class MemorySnapshotStore:
    def __init__(self, rows: dict[str, StoredSnapshot] | None = None) -> None:
        self.rows = dict(rows or {})
        self.reads = 0

    async def get_by_key(self, key: str) -> StoredSnapshot | None:
        self.reads += 1
        return self.rows.get(key)

    async def list_endpoint(self, endpoint: str) -> list[StoredSnapshot]:
        return [row for row in self.rows.values() if row.endpoint == endpoint]

    async def upsert(self, snapshot: StoredSnapshot) -> None:
        self.rows[snapshot.cache_key] = snapshot


class FakeSnapshots:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.pending: dict[str, object] | None = None

    def select(self, *_args: object, **_kwargs: object) -> "FakeSnapshots":
        self.pending = None
        self._filters: dict[str, object] = {}
        self._limit: int | None = None
        return self

    def eq(self, key: str, value: object) -> "FakeSnapshots":
        self._filters[key] = value
        return self

    def limit(self, count: int) -> "FakeSnapshots":
        self._limit = count
        return self

    def upsert(self, body: dict[str, object], on_conflict: str = "cache_key") -> "FakeSnapshots":
        self.pending = body
        self._conflict = on_conflict
        return self

    def execute(self) -> SimpleNamespace:
        if self.pending is not None:
            self.rows.append(self.pending)
            return SimpleNamespace(data=[self.pending])
        matched = [row for row in self.rows if _row_matches(row, self._filters)]
        if self._limit is not None:
            matched = matched[: self._limit]
        return SimpleNamespace(data=matched)


class FakeSupabase:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.snapshots = FakeSnapshots(rows)

    def table(self, name: str) -> FakeSnapshots:
        assert name == "cmc_snapshots"
        return self.snapshots


def _row_matches(row: dict[str, object], filters: dict[str, object]) -> bool:
    return all(row.get(key) == value for key, value in filters.items())


def live_payload() -> dict[str, object]:
    return {
        "data": {"1": {"symbol": "BTC"}},
        "status": {
            "timestamp": "2026-11-22T15:00:00.000Z",
            "error_code": 0,
            "error_message": None,
            "credit_count": 1,
        },
    }


def client_for(store: MemorySnapshotStore, **kwargs: object) -> CMCClient:
    return CMCClient(
        api_key="test-cmc-key",
        base_url=BASE,
        snapshot_store=store,
        simulate_basic_tier=False,
        sleep=kwargs.get("sleep") or _noop_sleep,  # type: ignore[arg-type]
        now=lambda: NOW,
    )


async def _noop_sleep(_seconds: float) -> None:
    return None


def snapshot(endpoint: str, params: dict[str, object], retrieved_at: datetime) -> StoredSnapshot:
    return StoredSnapshot(
        cache_key=cache_key(endpoint, params),
        endpoint=endpoint,
        params_json=dict(params),
        payload=live_payload(),
        source_timestamp=NOW,
        retrieved_at=retrieved_at,
        ttl_seconds=ttl_for_endpoint(endpoint),
        credit_cost=1,
        is_verified_fallback=True,
    )


async def test_l1_cache_hit_makes_no_second_http_call() -> None:
    store = MemorySnapshotStore()
    params = {"id": "1"}
    url = f"{BASE}{QUOTES}"
    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(return_value=httpx.Response(200, json=live_payload()))
        async with client_for(store) as client:
            first_payload, first_meta = await client.fetch(QUOTES, params, 120)
            second_payload, second_meta = await client.fetch(QUOTES, params, 120)
    assert route.call_count == 1
    assert store.reads == 1
    assert first_meta.data_mode == "LIVE"
    assert first_meta.cache_hit is False
    assert first_meta.credit_cost == 1
    assert second_meta.data_mode == "CACHED"
    assert second_meta.freshness == "FRESH"
    assert second_meta.cache_hit is True
    assert second_meta.credit_cost == 0
    assert second_payload == first_payload


async def test_l2_supabase_cache_hit_skips_http() -> None:
    params = {"id": "1"}
    key = cache_key(QUOTES, params)
    retrieved = (NOW - timedelta(seconds=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    fake = FakeSupabase(
        [
            {
                "cache_key": key,
                "endpoint": QUOTES,
                "params_json": params,
                "payload": live_payload(),
                "source_timestamp": "2026-11-22T14:59:00Z",
                "retrieved_at": retrieved,
                "ttl_seconds": 120,
                "credit_cost": 1,
                "is_verified_fallback": True,
            }
        ]
    )
    url = f"{BASE}{QUOTES}"
    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(return_value=httpx.Response(200, json=live_payload()))
        async with CMCClient(
            api_key="test-cmc-key",
            base_url=BASE,
            snapshot_store=SupabaseSnapshotStore(fake),
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as client:
            payload, meta = await client.fetch(QUOTES, params, 120)
    assert route.call_count == 0
    assert payload["data"] == {"1": {"symbol": "BTC"}}
    assert meta.data_mode == "CACHED"
    assert meta.freshness == "FRESH"
    assert meta.cache_hit is True
    assert meta.credit_cost == 0


async def test_retry_on_429_then_returns_live() -> None:
    slept: list[float] = []

    async def record_sleep(seconds: float) -> None:
        slept.append(seconds)

    store = MemorySnapshotStore()
    url = f"{BASE}{QUOTES}"
    responses = [
        httpx.Response(429, json={"status": {"error_code": 1008, "credit_count": 0}}),
        httpx.Response(429, json={"status": {"error_code": 1008, "credit_count": 0}}),
        httpx.Response(429, json={"status": {"error_code": 1008, "credit_count": 0}}),
        httpx.Response(200, json=live_payload()),
    ]
    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(side_effect=responses)
        async with client_for(store, sleep=record_sleep) as client:
            _payload, meta = await client.fetch(QUOTES, {"id": "1"}, 120)
    assert route.call_count == 4
    assert slept == [1, 2, 4]
    assert meta.data_mode == "LIVE"
    assert meta.credit_cost == 1
    assert meta.cache_hit is False


async def test_http_403_falls_back_to_verified_snapshot() -> None:
    params = {"id": "1"}
    stored = snapshot(OHLCV, params, NOW - timedelta(hours=2))
    store = MemorySnapshotStore({stored.cache_key: stored})
    url = f"{BASE}{OHLCV}"
    denied = {
        "status": {
            "error_code": 1006,
            "error_message": "Plan Upgrade Required",
            "credit_count": 0,
        }
    }
    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(return_value=httpx.Response(403, json=denied))
        async with client_for(store) as client:
            payload, meta = await client.fetch(OHLCV, params, 120)
    assert route.call_count == 1
    assert payload == live_payload()
    assert meta.data_mode == "VERIFIED_SNAPSHOT_FALLBACK"
    assert meta.freshness == "AGING"
    assert meta.cache_hit is False
    assert meta.credit_cost == 0
    assert meta.limitation is not None
    assert "1006" in meta.limitation
    assert "AGING" in meta.limitation


async def test_403_without_snapshot_raises_unavailable() -> None:
    store = MemorySnapshotStore()
    url = f"{BASE}{OHLCV}"
    with respx.mock(assert_all_called=False) as router:
        denied = httpx.Response(403, json={"status": {"error_code": 1006}})
        router.get(url).mock(return_value=denied)
        async with client_for(store) as client:
            try:
                await client.fetch(OHLCV, {"id": "1"}, 120)
            except CMCEndpointUnavailableError as exc:
                assert exc.endpoint == OHLCV
            else:
                raise AssertionError("expected CMCEndpointUnavailableError")


async def test_snapshot_older_than_one_day_is_stale() -> None:
    params = {"id": "1"}
    stored = snapshot(OHLCV, params, NOW - timedelta(hours=25))
    store = MemorySnapshotStore({stored.cache_key: stored})
    url = f"{BASE}{OHLCV}"
    with respx.mock(assert_all_called=False) as router:
        denied = httpx.Response(403, json={"status": {"error_code": 1006}})
        router.get(url).mock(return_value=denied)
        async with client_for(store) as client:
            _payload, meta = await client.fetch(OHLCV, params, 120)
    assert meta.freshness == "STALE"
    assert meta.data_mode == "VERIFIED_SNAPSHOT_FALLBACK"


async def test_simulated_basic_tier_uses_snapshot_without_http() -> None:
    params = {"id": "1"}
    stored = snapshot(OHLCV, params, NOW - timedelta(hours=2))
    store = MemorySnapshotStore({stored.cache_key: stored})
    url = f"{BASE}{OHLCV}"
    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(return_value=httpx.Response(200, json=live_payload()))
        async with CMCClient(
            api_key="test-cmc-key",
            base_url=BASE,
            snapshot_store=store,
            simulate_basic_tier=True,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as client:
            _payload, meta = await client.fetch(OHLCV, params, 120)
    assert route.call_count == 0
    assert meta.data_mode == "VERIFIED_SNAPSHOT_FALLBACK"
    assert "1006" in (meta.limitation or "")


async def test_ambiguous_symbol_uses_highest_market_cap_rank() -> None:
    resolution = await resolve_symbols_to_ids(
        ["sol", "missing"],
        rows=[
            {"cmc_id": 5426, "symbol": "SOL", "rank": 200},
            {"cmc_id": 16116, "symbol": "sol", "rank": 5},
            {"cmc_id": 1, "symbol": "BTC", "rank": 1},
        ],
    )
    assert resolution.ids == {"SOL": 16116}
    assert resolution.limitations[0].startswith("SOL matched 2 assets")
    assert "cmc_id 16116" in resolution.limitations[0]
    assert "MISSING was not found" in resolution.limitations[1]


def test_cache_key_ignores_param_order_and_ttl_families() -> None:
    left = cache_key(QUOTES, {"convert": "USD", "id": "1"})
    right = cache_key(QUOTES, {"id": "1", "convert": "USD"})
    assert left == right
    assert ttl_for_endpoint(QUOTES) == 120
    assert ttl_for_endpoint("/v3/fear-and-greed/latest") == 300
    assert ttl_for_endpoint(OHLCV) == 3600


async def test_ttl_multiplier_scales_effective_cache_lifetime() -> None:
    store = MemorySnapshotStore()
    params = {"id": "1"}
    url = f"{BASE}{QUOTES}"
    clock = [NOW]

    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(return_value=httpx.Response(200, json=live_payload()))
        async with CMCClient(
            api_key="test-cmc-key",
            base_url=BASE,
            snapshot_store=store,
            simulate_basic_tier=False,
            ttl_multiplier=2.5,
            sleep=_noop_sleep,
            now=lambda: clock[0],
        ) as client:
            _, first = await client.fetch(QUOTES, params)
            clock[0] = NOW + timedelta(seconds=240)
            _, second = await client.fetch(QUOTES, params)
            clock[0] = NOW + timedelta(seconds=310)
            _, third = await client.fetch(QUOTES, params)

    assert route.call_count == 2
    assert first.data_mode == "LIVE"
    assert second.data_mode == "CACHED"
    assert second.credit_cost == 0
    assert third.data_mode == "LIVE"


async def test_inflight_locks_are_cleaned_up_after_concurrent_fetches() -> None:
    import asyncio

    store = MemorySnapshotStore()
    url = f"{BASE}{QUOTES}"
    with respx.mock(assert_all_called=False) as router:
        route = router.get(url).mock(return_value=httpx.Response(200, json=live_payload()))
        async with client_for(store) as client:
            results = await asyncio.gather(
                client.fetch(QUOTES, {"id": "1"}, 120),
                client.fetch(QUOTES, {"id": "1"}, 120),
                client.fetch(QUOTES, {"id": "1"}, 120),
            )
            assert len(client._inflight) == 0
    assert route.call_count == 1
    assert len(results) == 3


async def test_derivatives_stale_snapshot_fallback_never_reports_live() -> None:
    endpoint = "/v5/cryptocurrency/derivatives/market-pairs/list/latest"
    params = {"crypto_id": 1, "limit": 25}
    stored = snapshot(endpoint, params, NOW - timedelta(hours=30))
    store = MemorySnapshotStore({stored.cache_key: stored})
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}{endpoint}").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        )
        async with client_for(store) as client:
            _payload, meta = await client.fetch(endpoint, params)
    assert meta.data_mode == "VERIFIED_SNAPSHOT_FALLBACK"
    assert meta.freshness == "STALE"
    assert meta.credit_cost == 0


async def test_byok_403_does_not_leak_server_snapshot_and_marks_tier_restricted() -> None:
    params = {"id": "1"}
    stored = snapshot(OHLCV, params, NOW - timedelta(hours=1))
    store = MemorySnapshotStore({stored.cache_key: stored})
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}{OHLCV}").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        )
        async with client_for(store) as client:
            try:
                await client.fetch(OHLCV, params, override_api_key="byok_user_key_no_access_123")
            except CMCEndpointUnavailableError as exc:
                assert exc.category == "tier_restricted"
                assert exc.tier_restricted is True
                assert exc.http_status == 403
                assert exc.cmc_error_code == 1006
                assert "1006" in exc.reason
            else:
                raise AssertionError("expected CMCEndpointUnavailableError for restricted BYOK")


async def test_byok_error_taxonomy_and_no_server_snapshot_leak() -> None:
    params = {"id": "1"}
    stored = snapshot(OHLCV, params, NOW - timedelta(hours=1))
    store = MemorySnapshotStore({stored.cache_key: stored})
    url = f"{BASE}{OHLCV}"

    cases = [
        (
            "auth_401",
            httpx.Response(401, json={"status": {"error_code": 1001}}),
            "auth_invalid",
            False,
            401,
            [],
        ),
        (
            "tier_403",
            httpx.Response(403, json={"status": {"error_code": 1006}}),
            "tier_restricted",
            True,
            403,
            [],
        ),
        (
            "rate_429",
            httpx.Response(429, json={"status": {"error_code": 1008}}),
            "rate_limited",
            False,
            429,
            [1, 2, 4],
        ),
        (
            "server_503",
            httpx.Response(503, json={"status": {"error_code": 500}}),
            "transient_error",
            False,
            503,
            [1, 2, 4],
        ),
    ]

    for label, response, expected_category, expected_tier, expected_http, expected_sleeps in cases:
        slept: list[float] = []

        async def record_sleep(seconds: float, bucket: list[float] = slept) -> None:
            bucket.append(seconds)

        with respx.mock(assert_all_called=False) as router:
            router.get(url).mock(return_value=response)
            async with client_for(store, sleep=record_sleep) as client:
                try:
                    await client.fetch(OHLCV, params, override_api_key=f"byok_{label}_key_12345")
                except CMCEndpointUnavailableError as exc:
                    assert exc.category == expected_category, label
                    assert exc.tier_restricted is expected_tier, label
                    assert exc.http_status == expected_http, label
                else:
                    raise AssertionError(f"expected error for {label}")
        assert slept == expected_sleeps, label

    # Network TransportError on BYOK must also NOT fall back to server snapshot
    net_slept: list[float] = []

    async def net_sleep(seconds: float) -> None:
        net_slept.append(seconds)

    with respx.mock(assert_all_called=False) as router:
        router.get(url).mock(side_effect=httpx.ConnectError("upstream down"))
        async with client_for(store, sleep=net_sleep) as client:
            try:
                await client.fetch(OHLCV, params, override_api_key="byok_net_err_key_12345")
            except CMCEndpointUnavailableError as exc:
                assert exc.category == "transient_error"
                assert exc.tier_restricted is False
            else:
                raise AssertionError("expected transient_error on BYOK network outage")
    assert net_slept == [1, 2, 4]


async def test_byok_retry_isolation_between_concurrent_keys() -> None:
    import asyncio

    store = MemorySnapshotStore()
    url = f"{BASE}{QUOTES}"
    key_a = "byok_retry_alpha_12345"
    key_b = "byok_retry_beta_67890"
    seen_counts = {key_a: 0, key_b: 0}

    def responder(request: httpx.Request) -> httpx.Response:
        sent_key = request.headers.get("X-CMC_PRO_API_KEY", "")
        seen_counts[sent_key] = seen_counts.get(sent_key, 0) + 1
        if sent_key == key_a:
            if seen_counts[sent_key] < 3:
                return httpx.Response(503, json={"status": {"error_code": 500}})
            return httpx.Response(200, json=live_payload())
        return httpx.Response(429, json={"status": {"error_code": 1008}})

    with respx.mock(assert_all_called=False) as router:
        router.get(url).mock(side_effect=responder)
        async with client_for(store) as client:
            task_a = asyncio.create_task(client.fetch(QUOTES, {"id": "1"}, override_api_key=key_a))
            task_b = asyncio.create_task(client.fetch(QUOTES, {"id": "1"}, override_api_key=key_b))
            res_a = await task_a
            try:
                await task_b
            except CMCEndpointUnavailableError as exc_b:
                assert exc_b.category == "rate_limited"
                assert exc_b.tier_restricted is False
            else:
                raise AssertionError("expected key_b rate_limited")

    assert res_a[1].data_mode == "LIVE"
    assert seen_counts[key_a] == 3
    assert seen_counts[key_b] == 4
    # Private BYOK responses must never write into shared server snapshot store
    assert store.rows == {}
