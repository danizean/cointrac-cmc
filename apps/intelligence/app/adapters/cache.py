import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from cachetools import TTLCache

ENDPOINT_TTL_SECONDS: dict[str, int] = {
    "/v1/cryptocurrency/listings/latest": 120,
    "/v2/cryptocurrency/quotes/latest": 120,
    "/v1/global-metrics/quotes/latest": 300,
    "/v3/fear-and-greed/latest": 300,
    "/v1/cryptocurrency/categories": 900,
    "/v1/cryptocurrency/category": 900,
    "/v2/cryptocurrency/info": 3600,
    "/v2/cryptocurrency/ohlcv/historical": 3600,
    "/v1/cryptocurrency/map": 3600,
}
DEFAULT_TTL_SECONDS = 120
MAX_TTL_SECONDS = 43200


def ttl_for_endpoint(endpoint: str) -> int:
    return ENDPOINT_TTL_SECONDS.get(endpoint, DEFAULT_TTL_SECONDS)


def canonical_query(params: dict[str, object]) -> str:
    parts: list[str] = []
    for key in sorted(params):
        value = params[key]
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            rendered = ",".join(str(item) for item in value)
        else:
            rendered = str(value)
        parts.append(f"{key}={rendered}")
    return "&".join(parts)


def cache_key(endpoint: str, params: dict[str, object]) -> str:
    material = f"{endpoint}?{canonical_query(params)}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class CachedPayload:
    payload: dict[str, object]
    source_timestamp: datetime | None
    retrieved_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class StoredSnapshot:
    cache_key: str
    endpoint: str
    params_json: dict[str, object]
    payload: dict[str, object]
    source_timestamp: datetime | None
    retrieved_at: datetime
    ttl_seconds: int
    credit_cost: int
    is_verified_fallback: bool


class SnapshotStore(Protocol):
    async def get_by_key(self, cache_key: str) -> StoredSnapshot | None: ...

    async def list_endpoint(self, endpoint: str) -> list[StoredSnapshot]: ...

    async def upsert(self, snapshot: StoredSnapshot) -> None: ...


class L1Cache:
    def __init__(self) -> None:
        self._items: TTLCache[str, CachedPayload] = TTLCache(maxsize=1024, ttl=MAX_TTL_SECONDS)

    def get(self, key: str, now: datetime) -> CachedPayload | None:
        item = self._items.get(key)
        if item is None:
            return None
        if item.expires_at <= now:
            self._items.pop(key, None)
            return None
        return item

    def put(self, key: str, item: CachedPayload) -> None:
        self._items[key] = item


def params_cover(stored: dict[str, object], requested: dict[str, object]) -> bool:
    for key, value in requested.items():
        if stored.get(key) != value:
            return False
    return True


def parse_timestamp(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return None


def freshness_for_age(age: timedelta) -> str:
    if age < timedelta(hours=24):
        return "AGING"
    return "STALE"
