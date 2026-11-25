"""In-process notices when the warmer stores a new market snapshot.

The notice carries no market payload. Cache hits, failures, and cutoff do not
publish. Subscribers live in this process only.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger("cointrac.market_events")

STREAM_ENDPOINTS = frozenset(
    {
        "/v1/cryptocurrency/listings/latest",
        "/v2/cryptocurrency/quotes/latest",
        "/v1/global-metrics/quotes/latest",
        "/v3/fear-and-greed/latest",
    }
)


@dataclass(frozen=True)
class MarketSnapshotEvent:
    endpoint: str
    retrieved_at_utc: datetime
    cadence_seconds: int
    effective_tier: str


class MarketEventBus:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[MarketSnapshotEvent]] = []

    def subscribe(self) -> asyncio.Queue[MarketSnapshotEvent]:
        queue: asyncio.Queue[MarketSnapshotEvent] = asyncio.Queue(maxsize=32)
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[MarketSnapshotEvent]) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def publish(self, event: MarketSnapshotEvent) -> None:
        if event.endpoint not in STREAM_ENDPOINTS:
            return
        for queue in list(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(event)
        _notify_mcp_best_effort(event)


_bus = MarketEventBus()


def get_market_event_bus() -> MarketEventBus:
    return _bus


def install_market_event_bus(bus: MarketEventBus | None) -> None:
    global _bus
    _bus = bus if bus is not None else MarketEventBus()


def _notify_mcp_best_effort(event: MarketSnapshotEvent) -> None:
    """Best-effort only. A missing session must not affect the warmer or the SSE stream."""
    try:
        from app.mcp.server import mcp

        manager = getattr(mcp, "session_manager", None)
        sessions = getattr(manager, "_server_instances", None)
        if not sessions:
            return
        logger.info(
            "mcp resource update available endpoint=%s cadence_s=%s",
            event.endpoint,
            event.cadence_seconds,
        )
    except Exception as exc:
        logger.info("mcp resource notification skipped error_type=%s", exc.__class__.__name__)
