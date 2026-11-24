import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import httpx

from app.adapters.cache import (
    CachedPayload,
    L1Cache,
    SnapshotStore,
    StoredSnapshot,
    cache_key,
    freshness_for_age,
    params_cover,
    parse_timestamp,
    ttl_for_endpoint,
)
from app.core.config import get_settings
from app.core.db import supabase_client

CMC_KEY_HEADER = "X-CMC_PRO_API_KEY"
RETRY_DELAYS_SECONDS = (1, 2, 4)
STARTUP_ONLY_ENDPOINTS = frozenset(
    {
        "/v1/cryptocurrency/trending/latest",
        "/v1/global-metrics/quotes/historical",
        "/v2/cryptocurrency/ohlcv/historical",
        "/v2/cryptocurrency/price-performance-stats/latest",
        "/v3/fear-and-greed/historical",
        "/v4/dex/spot-pairs/latest",
        "/v5/cryptocurrency/derivatives/market-pairs/list/latest",
        "/v5/derivatives/liquidations/quotes/latest",
        "/v5/exchange/derivatives/list",
        "/v5/real-world-assets/assets/list",
        "/v5/real-world-assets/map",
    }
)


CMCErrorCategory = Literal[
    "auth_invalid",
    "tier_restricted",
    "rate_limited",
    "transient_error",
    "client_error",
]
_AUTH_ERROR_CODES = frozenset({1001, 1002})
_RATE_LIMIT_ERROR_CODES = frozenset({1008, 1009, 1010, 1011})


class CMCTierRestrictedError(Exception):
    def __init__(self, code: int = 1006) -> None:
        self.code = code
        super().__init__(f"CMC plan upgrade required ({code})")


class CMCEndpointUnavailableError(Exception):
    def __init__(
        self,
        endpoint: str,
        reason: str,
        *,
        category: CMCErrorCategory = "client_error",
        http_status: int | None = None,
        cmc_error_code: int | None = None,
        tier_restricted: bool | None = None,
    ) -> None:
        resolved_category: CMCErrorCategory = (
            "tier_restricted"
            if tier_restricted is True and category == "client_error"
            else category
        )
        self.endpoint = endpoint
        self.reason = reason
        self.category: CMCErrorCategory = resolved_category
        self.http_status = http_status
        self.cmc_error_code = cmc_error_code
        self.tier_restricted = resolved_category == "tier_restricted"
        super().__init__(f"{endpoint} is unavailable: {reason}")


@dataclass(frozen=True)
class FetchMeta:
    data_mode: str
    freshness: str
    cache_hit: bool
    credit_cost: int
    source_timestamp: datetime | None = None
    retrieved_at: datetime | None = None
    limitation: str | None = None


class SupabaseSnapshotStore:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    def _table(self) -> Any:
        client = self._client if self._client is not None else supabase_client()
        return client.table("cmc_snapshots")

    async def get_by_key(self, key: str) -> StoredSnapshot | None:
        response = await asyncio.to_thread(
            lambda: self._table().select("*").eq("cache_key", key).limit(1).execute()
        )
        rows = response.data or []
        if not rows:
            return None
        return _row_to_snapshot(rows[0])

    async def list_endpoint(self, endpoint: str) -> list[StoredSnapshot]:
        response = await asyncio.to_thread(
            lambda: self._table().select("*").eq("endpoint", endpoint).execute()
        )
        return [_row_to_snapshot(row) for row in response.data or []]

    async def upsert(self, snapshot: StoredSnapshot) -> None:
        body = _snapshot_row(snapshot)
        await asyncio.to_thread(
            lambda: self._table().upsert(body, on_conflict="cache_key").execute()
        )


class CMCClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        snapshot_store: SnapshotStore | None = None,
        l1: L1Cache | None = None,
        startup_only: frozenset[str] = STARTUP_ONLY_ENDPOINTS,
        simulate_basic_tier: bool | None = None,
        ttl_multiplier: float | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
        now: Callable[[], datetime] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        settings = get_settings()
        resolved_key = api_key if api_key is not None else settings.cmc_api_key.get_secret_value()
        self._api_key = resolved_key.strip()
        self._base_url = (base_url or settings.cmc_base_url).rstrip("/")
        self._store = snapshot_store if snapshot_store is not None else SupabaseSnapshotStore()
        self._l1 = l1 if l1 is not None else L1Cache()
        self._startup_only = startup_only
        if simulate_basic_tier is None:
            self._simulate_basic = settings.force_simulate_basic_tier
        else:
            self._simulate_basic = simulate_basic_tier
        resolved_mult = (
            settings.cmc_cache_ttl_multiplier if ttl_multiplier is None else ttl_multiplier
        )
        self._ttl_multiplier = max(0.5, min(12.0, float(resolved_mult)))
        self._sleep = sleep or asyncio.sleep
        self._now = now or (lambda: datetime.now(UTC))
        self._client = client
        self._owns_client = client is None
        self._inflight: dict[str, tuple[asyncio.Lock, int]] = {}

    async def __aenter__(self) -> "CMCClient":
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self._base_url, timeout=20.0)
        return self

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    async def fetch(
        self,
        endpoint: str,
        params: dict[str, object],
        ttl_seconds: int | None = None,
        override_api_key: str | None = None,
    ) -> tuple[dict[str, object], FetchMeta]:
        if ttl_seconds is None:
            ttl = max(30, int(round(ttl_for_endpoint(endpoint) * self._ttl_multiplier)))
        else:
            ttl = ttl_seconds
        key = cache_key(endpoint, params)
        private = bool(override_api_key)

        if private:
            return await self._fetch_uncached(endpoint, params, ttl, key, override_api_key)

        # Fast path: L1 hit needs no lock
        now = self._now()
        l1_hit = self._l1.get(key, now)
        if l1_hit is not None:
            return l1_hit.payload, _cached_meta(l1_hit)

        # Single-flight lock coalesces concurrent misses and cleans up once idle
        entry = self._inflight.get(key)
        if entry is None:
            lock = asyncio.Lock()
            self._inflight[key] = (lock, 1)
        else:
            lock, waiters = entry
            self._inflight[key] = (lock, waiters + 1)
        try:
            async with lock:
                now = self._now()
                cached = await self._read_cache(key, ttl, now)
                if cached is not None:
                    return cached
                return await self._fetch_uncached(endpoint, params, ttl, key, None)
        finally:
            current = self._inflight.get(key)
            if current is not None:
                current_lock, remaining = current
                if remaining <= 1:
                    self._inflight.pop(key, None)
                else:
                    self._inflight[key] = (current_lock, remaining - 1)

    async def _fetch_uncached(
        self,
        endpoint: str,
        params: dict[str, object],
        ttl: int,
        key: str,
        override_api_key: str | None,
    ) -> tuple[dict[str, object], FetchMeta]:
        private = bool(override_api_key)
        if self._simulate_basic and not private and endpoint in self._startup_only:
            try:
                raise CMCTierRestrictedError(1006)
            except CMCTierRestrictedError as exc:
                return await self._fallback(
                    endpoint,
                    params,
                    key,
                    f"simulated CMC {exc.code}",
                    category="tier_restricted",
                    cmc_error_code=exc.code,
                )

        api_key = override_api_key or self._api_key
        try:
            response = await self._request_with_retry(endpoint, params, api_key)
        except httpx.TransportError as exc:
            reason = f"network outage: {exc.__class__.__name__}"
            if private:
                raise CMCEndpointUnavailableError(
                    endpoint,
                    reason,
                    category="transient_error",
                ) from exc
            return await self._fallback(
                endpoint,
                params,
                key,
                reason,
                category="transient_error",
            )

        payload = _json_object(response)
        error_code = _error_code(payload)
        if response.status_code == 401 or error_code in _AUTH_ERROR_CODES:
            reason = f"HTTP {response.status_code} CMC {error_code} Invalid API Key / Unauthorized"
            if private:
                raise CMCEndpointUnavailableError(
                    endpoint,
                    reason,
                    category="auth_invalid",
                    http_status=response.status_code,
                    cmc_error_code=error_code,
                )
            return await self._fallback(
                endpoint,
                params,
                key,
                reason,
                category="auth_invalid",
                http_status=response.status_code,
                cmc_error_code=error_code,
            )
        if response.status_code == 403 or error_code == 1006:
            reason = _restriction_reason(response.status_code, error_code)
            if private:
                raise CMCEndpointUnavailableError(
                    endpoint,
                    reason,
                    category="tier_restricted",
                    http_status=response.status_code,
                    cmc_error_code=error_code,
                )
            return await self._fallback(
                endpoint,
                params,
                key,
                reason,
                category="tier_restricted",
                http_status=response.status_code,
                cmc_error_code=error_code,
            )
        if response.status_code == 429 or error_code in _RATE_LIMIT_ERROR_CODES:
            reason = f"CMC HTTP {response.status_code} rate limit exceeded after retries"
            if private:
                raise CMCEndpointUnavailableError(
                    endpoint,
                    reason,
                    category="rate_limited",
                    http_status=response.status_code,
                    cmc_error_code=error_code,
                )
            return await self._fallback(
                endpoint,
                params,
                key,
                reason,
                category="rate_limited",
                http_status=response.status_code,
                cmc_error_code=error_code,
            )
        if response.status_code >= 500:
            reason = f"CMC HTTP {response.status_code} upstream server error after retries"
            if private:
                raise CMCEndpointUnavailableError(
                    endpoint,
                    reason,
                    category="transient_error",
                    http_status=response.status_code,
                    cmc_error_code=error_code,
                )
            return await self._fallback(
                endpoint,
                params,
                key,
                reason,
                category="transient_error",
                http_status=response.status_code,
                cmc_error_code=error_code,
            )
        if response.status_code != 200 or error_code not in {None, 0}:
            detail = f"HTTP {response.status_code} code {error_code}"
            raise CMCEndpointUnavailableError(
                endpoint,
                detail,
                category="client_error",
                http_status=response.status_code,
                cmc_error_code=error_code,
            )

        status = payload.get("status") if isinstance(payload.get("status"), dict) else {}
        credit_cost = _credit_count(status)
        source_timestamp = None
        if isinstance(status, dict):
            source_timestamp = parse_timestamp(status.get("timestamp"))
        retrieved_at = self._now()
        meta = FetchMeta(
            data_mode="LIVE",
            freshness="FRESH",
            cache_hit=False,
            credit_cost=credit_cost,
            source_timestamp=source_timestamp,
            retrieved_at=retrieved_at,
        )
        if not private:
            await self._write_cache(key, endpoint, params, payload, meta, ttl)
        return payload, meta

    async def _read_cache(
        self,
        key: str,
        ttl: int,
        now: datetime,
    ) -> tuple[dict[str, object], FetchMeta] | None:
        cached = self._l1.get(key, now)
        if cached is not None:
            return cached.payload, _cached_meta(cached)
        snapshot = await self._store.get_by_key(key)
        if snapshot is None or not snapshot.is_verified_fallback:
            return None
        age = now - snapshot.retrieved_at
        if age >= timedelta(seconds=ttl):
            return None
        self._remember(key, snapshot, ttl)
        return snapshot.payload, _cached_meta_from_snapshot(snapshot)

    async def _write_cache(
        self,
        key: str,
        endpoint: str,
        params: dict[str, object],
        payload: dict[str, object],
        meta: FetchMeta,
        ttl: int,
    ) -> None:
        retrieved_at = meta.retrieved_at or self._now()
        snapshot = StoredSnapshot(
            cache_key=key,
            endpoint=endpoint,
            params_json=dict(params),
            payload=payload,
            source_timestamp=meta.source_timestamp,
            retrieved_at=retrieved_at,
            ttl_seconds=ttl,
            credit_cost=meta.credit_cost,
            is_verified_fallback=True,
        )
        await self._store.upsert(snapshot)
        self._remember(key, snapshot, ttl)

    def _remember(self, key: str, snapshot: StoredSnapshot, ttl: int) -> None:
        expires_at = snapshot.retrieved_at + timedelta(seconds=ttl)
        if expires_at <= self._now():
            return
        self._l1.put(
            key,
            CachedPayload(
                payload=snapshot.payload,
                source_timestamp=snapshot.source_timestamp,
                retrieved_at=snapshot.retrieved_at,
                expires_at=expires_at,
            ),
        )

    async def _request_with_retry(
        self,
        endpoint: str,
        params: dict[str, object],
        api_key: str,
    ) -> httpx.Response:
        if self._client is not None:
            return await self._send_with_retry(self._client, endpoint, params, api_key)
        async with httpx.AsyncClient(base_url=self._base_url, timeout=20.0) as client:
            return await self._send_with_retry(client, endpoint, params, api_key)

    async def _send_with_retry(
        self,
        client: httpx.AsyncClient,
        endpoint: str,
        params: dict[str, object],
        api_key: str,
    ) -> httpx.Response:
        delays = RETRY_DELAYS_SECONDS
        attempt = 0
        while True:
            try:
                response = await client.get(
                    endpoint,
                    params=params,
                    headers={CMC_KEY_HEADER: api_key, "Accept": "application/json"},
                )
            except httpx.TransportError:
                if attempt >= len(delays):
                    raise
                await self._sleep(delays[attempt])
                attempt += 1
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= len(delays):
                    return response
                await self._sleep(delays[attempt])
                attempt += 1
                continue
            return response

    async def _fallback(
        self,
        endpoint: str,
        params: dict[str, object],
        key: str,
        reason: str,
        *,
        category: CMCErrorCategory = "client_error",
        http_status: int | None = None,
        cmc_error_code: int | None = None,
    ) -> tuple[dict[str, object], FetchMeta]:
        snapshot = await self._store.get_by_key(key)
        if snapshot is None or not snapshot.is_verified_fallback:
            listed = await self._store.list_endpoint(endpoint)
            matches = [
                row
                for row in listed
                if row.is_verified_fallback and params_cover(row.params_json, params)
            ]
            snapshot = max(matches, key=lambda row: row.retrieved_at) if matches else None
        if snapshot is None:
            raise CMCEndpointUnavailableError(
                endpoint,
                reason,
                category=category,
                http_status=http_status,
                cmc_error_code=cmc_error_code,
            )
        age = self._now() - snapshot.retrieved_at
        freshness = freshness_for_age(age)
        retrieved = _iso(snapshot.retrieved_at)
        limitation = (
            f"{endpoint} used a verified snapshot from {retrieved} ({freshness}) "
            f"because the live CoinMarketCap call failed: {reason}."
        )
        return snapshot.payload, FetchMeta(
            data_mode="VERIFIED_SNAPSHOT_FALLBACK",
            freshness=freshness,
            cache_hit=False,
            credit_cost=0,
            source_timestamp=snapshot.source_timestamp,
            retrieved_at=snapshot.retrieved_at,
            limitation=limitation,
        )


def _cached_meta(item: CachedPayload) -> FetchMeta:
    return FetchMeta(
        data_mode="CACHED",
        freshness="FRESH",
        cache_hit=True,
        credit_cost=0,
        source_timestamp=item.source_timestamp,
        retrieved_at=item.retrieved_at,
    )


def _cached_meta_from_snapshot(snapshot: StoredSnapshot) -> FetchMeta:
    return FetchMeta(
        data_mode="CACHED",
        freshness="FRESH",
        cache_hit=True,
        credit_cost=0,
        source_timestamp=snapshot.source_timestamp,
        retrieved_at=snapshot.retrieved_at,
    )


def _json_object(response: httpx.Response) -> dict[str, object]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    if isinstance(payload, dict):
        return payload
    return {}


def _error_code(payload: dict[str, object]) -> int | None:
    status = payload.get("status")
    if not isinstance(status, dict):
        return None
    code = status.get("error_code")
    if isinstance(code, int):
        return code
    return None


def _credit_count(status: object) -> int:
    if not isinstance(status, dict):
        return 0
    credit = status.get("credit_count")
    if isinstance(credit, int):
        return credit
    return 0


def _restriction_reason(status_code: int, error_code: int | None) -> str:
    return f"HTTP {status_code} CMC {error_code} Plan Upgrade Required"


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _row_to_snapshot(row: dict[str, Any]) -> StoredSnapshot:
    params = row.get("params_json") or {}
    payload = row.get("payload") or {}
    return StoredSnapshot(
        cache_key=str(row["cache_key"]),
        endpoint=str(row["endpoint"]),
        params_json=params if isinstance(params, dict) else {},
        payload=payload if isinstance(payload, dict) else {},
        source_timestamp=parse_timestamp(row.get("source_timestamp")),
        retrieved_at=parse_timestamp(row.get("retrieved_at")) or datetime.now(UTC),
        ttl_seconds=int(row.get("ttl_seconds") or 0),
        credit_cost=int(row.get("credit_cost") or 0),
        is_verified_fallback=bool(row.get("is_verified_fallback", True)),
    )


def _snapshot_row(snapshot: StoredSnapshot) -> dict[str, object]:
    return {
        "cache_key": snapshot.cache_key,
        "endpoint": snapshot.endpoint,
        "params_json": snapshot.params_json,
        "payload": snapshot.payload,
        "source_timestamp": _iso(snapshot.source_timestamp),
        "retrieved_at": _iso(snapshot.retrieved_at),
        "ttl_seconds": snapshot.ttl_seconds,
        "credit_cost": snapshot.credit_cost,
        "is_verified_fallback": True,
    }
