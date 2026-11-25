"""SQLite ledger used to exercise reservation, aggregation, and restart.

This is not the production store. Production calls the Postgres functions in
migration 010. The SQL here still aggregates with SUM and COUNT and takes a
write transaction before deciding, so concurrency tests are not in-memory mocks.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.services.budget import (
    BudgetCaller,
    BudgetDecision,
    CallPriority,
    MonthUsage,
    QuotaProfile,
    ReconcileOutcome,
    UsageCacheStatus,
    decide_reservation,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cmc_usage (
    idempotency_key TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    credit_cost INTEGER NOT NULL,
    credit_status TEXT NOT NULL,
    reservation_credits INTEGER NOT NULL,
    released INTEGER NOT NULL DEFAULT 0,
    cache_status TEXT NOT NULL,
    error_category TEXT,
    caller TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
"""

_COMMITTED = """
CASE
    WHEN released = 1 THEN 0
    WHEN credit_status = 'known' THEN credit_cost
    ELSE reservation_credits
END
"""

_TOTALS = f"""
SELECT
    COALESCE(SUM({_COMMITTED}), 0),
    COUNT(*),
    COALESCE(SUM(CASE WHEN cache_status = 'WARMER_MISS' THEN ({_COMMITTED}) ELSE 0 END), 0)
FROM cmc_usage
WHERE created_at >= ? AND created_at < ?
"""


def _iso(value: datetime) -> str:
    stamp = value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def _bounds(year: int, month: int) -> tuple[str, str]:
    start = datetime(year, month, 1, tzinfo=UTC)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(year, month + 1, 1, tzinfo=UTC)
    return _iso(start), _iso(end)


class SqliteBudgetStore:
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        with self._connect() as conn:
            conn.executescript(_SCHEMA)
            conn.commit()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def monthly_totals_blocking(self, year: int, month: int) -> MonthUsage:
        start, end = _bounds(year, month)
        with self._connect() as conn:
            row = conn.execute(_TOTALS, (start, end)).fetchone()
        if row is None or row[0] is None or row[1] is None or row[2] is None:
            raise RuntimeError("null sqlite aggregate")
        return MonthUsage(credits=int(row[0]), calls=int(row[1]), warmer_credits=int(row[2]))

    async def monthly_totals(self, year: int, month: int) -> MonthUsage:
        return self.monthly_totals_blocking(year, month)

    def reserve_blocking(
        self,
        *,
        idempotency_key: str,
        endpoint: str,
        reservation_credits: int,
        monthly_budget: int,
        priority: CallPriority | None,
        cache_status: UsageCacheStatus,
        caller: BudgetCaller,
        attempt_no: int,
        quota_profile: QuotaProfile,
        explicit_ttl_multiplier: float | None,
        now: datetime,
    ) -> BudgetDecision:
        stamp = now.astimezone(UTC) if now.tzinfo else now.replace(tzinfo=UTC)
        start, end = _bounds(stamp.year, stamp.month)
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(
                "SELECT released, reservation_credits FROM cmc_usage WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            usage_row = conn.execute(_TOTALS, (start, end)).fetchone()
            if usage_row is None or usage_row[0] is None:
                raise RuntimeError("null sqlite aggregate")
            committed = int(usage_row[0])
            warmer = int(usage_row[2])
            if existing is not None:
                if int(existing[0]) == 1:
                    conn.execute("COMMIT")
                    return BudgetDecision(
                        allowed=False,
                        state="CUTOFF",
                        warning_level="CUTOFF",
                        utilization_pct=None,
                        ttl_multiplier=0.0,
                        idempotency_key=idempotency_key,
                        reservation_credits=reservation_credits,
                        reason="Reservation was already released.",
                    )
                decision = decide_reservation(
                    committed=committed,
                    warmer_committed=warmer,
                    monthly_budget=monthly_budget,
                    reservation_credits=int(existing[1]),
                    endpoint=endpoint,
                    priority=priority,
                    caller=caller,
                    quota_profile=quota_profile,
                    explicit_ttl_multiplier=explicit_ttl_multiplier,
                )
                conn.execute("COMMIT")
                return BudgetDecision(
                    allowed=True,
                    state=decision.state,
                    warning_level=decision.warning_level,
                    utilization_pct=decision.utilization_pct,
                    ttl_multiplier=decision.ttl_multiplier,
                    idempotency_key=idempotency_key,
                    reservation_credits=int(existing[1]),
                )
            decision = decide_reservation(
                committed=committed,
                warmer_committed=warmer,
                monthly_budget=monthly_budget,
                reservation_credits=reservation_credits,
                endpoint=endpoint,
                priority=priority,
                caller=caller,
                quota_profile=quota_profile,
                explicit_ttl_multiplier=explicit_ttl_multiplier,
            )
            if decision.allowed:
                conn.execute(
                    """
                    INSERT INTO cmc_usage (
                        idempotency_key, endpoint, credit_cost, credit_status,
                        reservation_credits, released, cache_status, error_category,
                        caller, attempt_no, created_at
                    ) VALUES (?, ?, ?, 'reserved', ?, 0, ?, NULL, ?, ?, ?)
                    """,
                    (
                        idempotency_key,
                        endpoint,
                        reservation_credits,
                        reservation_credits,
                        cache_status,
                        caller,
                        attempt_no,
                        _iso(now),
                    ),
                )
            conn.execute("COMMIT")
            return BudgetDecision(
                allowed=decision.allowed,
                state=decision.state,
                warning_level=decision.warning_level,
                utilization_pct=decision.utilization_pct,
                ttl_multiplier=decision.ttl_multiplier,
                reason=decision.reason,
                idempotency_key=idempotency_key if decision.allowed else None,
                reservation_credits=reservation_credits,
            )
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    async def reserve(self, **kwargs: object) -> BudgetDecision:
        return self.reserve_blocking(**kwargs)  # type: ignore[arg-type]

    def reconcile_blocking(
        self,
        *,
        idempotency_key: str,
        outcome: ReconcileOutcome,
        actual_credits: int | None,
        error_category: str | None,
        reservation_credits: int,
        endpoint: str,
        cache_status: UsageCacheStatus,
        caller: BudgetCaller,
        attempt_no: int,
        now: datetime,
    ) -> None:
        resolved = outcome
        if resolved == "known" and (actual_credits is None or actual_credits < 0):
            resolved = "unknown"
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """
                SELECT credit_status, released, reservation_credits
                FROM cmc_usage WHERE idempotency_key = ?
                """,
                (idempotency_key,),
            ).fetchone()
            if row is None:
                if resolved != "released":
                    hold = max(0, reservation_credits)
                    if resolved == "known" and actual_credits is not None:
                        cost = actual_credits
                    else:
                        cost = hold
                    conn.execute(
                        """
                        INSERT INTO cmc_usage (
                            idempotency_key, endpoint, credit_cost, credit_status,
                            reservation_credits, released, cache_status, error_category,
                            caller, attempt_no, created_at
                        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
                        """,
                        (
                            idempotency_key,
                            endpoint,
                            max(0, int(cost)),
                            "known" if resolved == "known" else "unknown",
                            hold,
                            cache_status,
                            error_category,
                            caller,
                            attempt_no,
                            _iso(now),
                        ),
                    )
                conn.execute("COMMIT")
                return
            status, released, hold = row
            if int(released) == 1 or status == "known":
                conn.execute("COMMIT")
                return
            if status == "unknown" and resolved == "released":
                conn.execute("COMMIT")
                return
            if resolved == "released":
                conn.execute(
                    """
                    UPDATE cmc_usage
                    SET released = 1, credit_cost = 0, error_category = COALESCE(?, error_category)
                    WHERE idempotency_key = ?
                    """,
                    (error_category, idempotency_key),
                )
            elif resolved == "unknown":
                kept = int(hold)
                conn.execute(
                    """
                    UPDATE cmc_usage
                    SET credit_status = 'unknown', credit_cost = ?, reservation_credits = ?,
                        error_category = COALESCE(?, error_category)
                    WHERE idempotency_key = ?
                    """,
                    (kept, kept, error_category, idempotency_key),
                )
            else:
                conn.execute(
                    """
                    UPDATE cmc_usage
                    SET credit_status = 'known', credit_cost = ?, error_category = ?
                    WHERE idempotency_key = ?
                    """,
                    (max(0, int(actual_credits or 0)), error_category, idempotency_key),
                )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    async def reconcile(self, **kwargs: object) -> None:
        self.reconcile_blocking(**kwargs)  # type: ignore[arg-type]

    async def mark_existing_unknown(
        self,
        *,
        idempotency_key: str,
        error_category: str | None,
        endpoint: str,
        cache_status: UsageCacheStatus,
        caller: BudgetCaller,
        attempt_no: int,
        now: datetime,
    ) -> None:
        del endpoint, cache_status, caller, attempt_no, now
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                """
                UPDATE cmc_usage
                SET credit_status = 'unknown',
                    credit_cost = reservation_credits,
                    error_category = COALESCE(?, error_category)
                WHERE idempotency_key = ?
                  AND released = 0
                  AND credit_status = 'reserved'
                """,
                (error_category, idempotency_key),
            )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    def insert_known_rows(self, count: int, credit_cost: int, created_at: datetime) -> None:
        stamp = _iso(created_at)
        rows = [
            (
                f"seed:{index}",
                "/v1/cryptocurrency/listings/latest",
                credit_cost,
                "known",
                credit_cost,
                0,
                "MISS",
                "user",
                1,
                stamp,
            )
            for index in range(count)
        ]
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO cmc_usage (
                    idempotency_key, endpoint, credit_cost, credit_status,
                    reservation_credits, released, cache_status, caller,
                    attempt_no, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
