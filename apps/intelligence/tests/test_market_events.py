"""Langkah 5 — warmer snapshot notices stay inside the process."""

from __future__ import annotations

import inspect
from datetime import UTC, datetime

from app.api.deps import require_api_key
from app.api.v1.router import snapshot_stream
from app.services.market_events import MarketEventBus, MarketSnapshotEvent, install_market_event_bus

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)


def test_only_a_new_snapshot_is_published() -> None:
    bus = MarketEventBus()
    install_market_event_bus(bus)
    queue = bus.subscribe()
    event = MarketSnapshotEvent(
        endpoint="/v1/global-metrics/quotes/latest",
        retrieved_at_utc=NOW,
        cadence_seconds=120,
        effective_tier="startup",
    )
    try:
        bus.publish(event)
        bus.publish(
            MarketSnapshotEvent(
                endpoint="/v1/cryptocurrency/map",
                retrieved_at_utc=NOW,
                cadence_seconds=604800,
                effective_tier="startup",
            )
        )
        assert queue.qsize() == 1
        assert queue.get_nowait() == event
    finally:
        install_market_event_bus(None)


def test_snapshot_stream_requires_the_same_auth_as_rest() -> None:
    default = inspect.signature(snapshot_stream).parameters["auth"].default
    assert getattr(default, "dependency", None) is require_api_key
