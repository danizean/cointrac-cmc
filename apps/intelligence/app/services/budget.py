"""Monthly CoinMarketCap server-key credit budget.

The database ledger is the source of truth. An in-process number is never treated
as the committed spend. Each server-key attempt reserves credits inside one
database critical section, then reconciles that reservation from CMC
``status.credit_count``. Cache hits and BYOK calls are not reserved.

A failed ledger read or write fails closed: the call is denied and the spend is
not reported as zero.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from app.core.config import QuotaProfile, Settings, get_settings

logger = logging.getLogger("cointrac.budget")

BudgetState = Literal["NORMAL", "CONSERVATION", "EMERGENCY", "CUTOFF"]
BudgetWarningLevel = Literal["NONE", "ELEVATED", "CONSERVATION", "EMERGENCY", "CUTOFF"]
CallPriority = Literal["core_warmer", "standard", "expensive"]
UsageCacheStatus = Literal["MISS", "WARMER_MISS", "REFRESH"]
BudgetCaller = Literal["user", "warmer"]
CreditStatus = Literal["reserved", "known", "unknown"]
ReconcileOutcome = Literal["known", "unknown", "released"]
LedgerStatus = Literal["ok", "unavailable"]

# Warmer-attributed rows may consume at most this share of the monthly budget.
# The remainder stays available for user-driven server-key calls.
WARMER_SPEND_SHARE_PERCENT = 40
DEFAULT_ATTEMPT_RESERVATION = 1

CORE_WARMER_ENDPOINTS: frozenset[str] = frozenset(
    {
        "/v1/cryptocurrency/listings/latest",
        "/v1/global-metrics/quotes/latest",
        "/v3/fear-and-greed/latest",
        "/v1/cryptocurrency/map",
    }
)

EXPENSIVE_ENDPOINTS: frozenset[str] = frozenset(
    {
        "/v1/cryptocurrency/categories",
        "/v1/cryptocurrency/category",
        "/v2/cryptocurrency/ohlcv/historical",
        "/v2/cryptocurrency/price-performance-stats/latest",
        "/v5/cryptocurrency/derivatives/market-pairs/list/latest",
        "/v5/derivatives/liquidations/quotes/latest",
        "/v5/exchange/derivatives/list",
        "/v5/real-world-assets/assets/list",
        "/v5/real-world-assets/map",
        "/v2/cryptocurrency/info",
    }
)

RESERVE_RPC = "cointrac_reserve_cmc_credit"
RECONCILE_RPC = "cointrac_reconcile_cmc_credit"
TOTALS_RPC = "cointrac_cmc_budget_totals"


class BudgetLedgerUnavailable(RuntimeError):
    """The credit ledger could not be read or written. Callers must fail closed."""


@dataclass(frozen=True)
class UsageEvent:
    endpoint: str
    credit_cost: int
    cache_status: UsageCacheStatus = "MISS"
    error_category: str | None = None
    created_at: datetime | None = None
    credit_status: CreditStatus = "known"
    idempotency_key: str | None = None
    released: bool = False
    reservation_credits: int = 0
    caller: BudgetCaller = "user"
    attempt_no: int = 1


@dataclass(frozen=True)
class MonthUsage:
    credits: int
    calls: int
    warmer_credits: int


@dataclass(frozen=True)
class BudgetSnapshot:
    quota_profile: QuotaProfile
    state: BudgetState
    warning_level: BudgetWarningLevel
    billing_month_utc: str
    monthly_budget_credits: int
    credits_used_this_month: int | None
    remaining_credits: int | None
    utilization_pct: float | None
    effective_ttl_multiplier: float
    upstream_calls_this_month: int | None
    warmer_credits_this_month: int | None = None
    ledger_status: LedgerStatus = "ok"

    def to_dict(self) -> dict[str, object]:
        return {
            "quota_profile": self.quota_profile,
            "state": self.state,
            "warning_level": self.warning_level,
            "billing_month_utc": self.billing_month_utc,
            "monthly_budget_credits": self.monthly_budget_credits,
            "credits_used_this_month": self.credits_used_this_month,
            "remaining_credits": self.remaining_credits,
            "utilization_pct": self.utilization_pct,
            "effective_ttl_multiplier": self.effective_ttl_multiplier,
            "upstream_calls_this_month": self.upstream_calls_this_month,
            "warmer_credits_this_month": self.warmer_credits_this_month,
            "ledger_status": self.ledger_status,
        }


@dataclass(frozen=True)
class BudgetDecision:
    allowed: bool
    state: BudgetState
    warning_level: BudgetWarningLevel
    utilization_pct: float | None
    ttl_multiplier: float
    reason: str | None = None
    idempotency_key: str | None = None
    reservation_credits: int = 0
    ledger_status: LedgerStatus = "ok"


def evaluate_budget_state(
    credits_used: int,
    monthly_budget: int,
) -> tuple[BudgetState, BudgetWarningLevel, float]:
    """Budget thresholds using integer cross-multiplication.

    - [0%, 70%)    -> NORMAL / NONE
    - [70%, 85%)   -> NORMAL / ELEVATED
    - [85%, 95%)   -> CONSERVATION / CONSERVATION
    - [95%, 100%)  -> EMERGENCY / EMERGENCY
    - [100%, +inf) -> CUTOFF / CUTOFF
    """
    used = max(0, int(credits_used))
    if monthly_budget <= 0:
        return "CUTOFF", "CUTOFF", 100.0
    pct = round((used / monthly_budget) * 100.0, 4)
    if used >= monthly_budget:
        return "CUTOFF", "CUTOFF", pct
    if used * 100 >= monthly_budget * 95:
        return "EMERGENCY", "EMERGENCY", pct
    if used * 100 >= monthly_budget * 85:
        return "CONSERVATION", "CONSERVATION", pct
    if used * 100 >= monthly_budget * 70:
        return "NORMAL", "ELEVATED", pct
    return "NORMAL", "NONE", pct


def resolve_ttl_multiplier(
    profile: QuotaProfile,
    budget_state: BudgetState,
    *,
    warning_level: BudgetWarningLevel = "NONE",
    explicit_override: float | None = None,
) -> float:
    from app.core.config import PROFILE_DEFAULT_TTL_MULTIPLIER

    base = (
        float(explicit_override)
        if explicit_override is not None
        else PROFILE_DEFAULT_TTL_MULTIPLIER[profile]
    )
    if profile == "adaptive":
        if budget_state == "CUTOFF":
            mult = max(base, 12.0)
        elif budget_state == "EMERGENCY":
            mult = max(base, 5.0)
        elif budget_state == "CONSERVATION":
            mult = max(base, 2.5)
        elif warning_level == "ELEVATED":
            mult = max(base, 1.5)
        else:
            mult = base
    elif budget_state == "CUTOFF":
        mult = max(base, 12.0)
    elif budget_state == "EMERGENCY":
        mult = max(base * 2.5, 5.0)
    elif budget_state == "CONSERVATION":
        mult = max(base * 1.5, 2.5)
    else:
        mult = base
    return max(0.5, min(12.0, float(mult)))


def warmer_credit_ceiling(monthly_budget: int) -> int:
    if monthly_budget <= 0:
        return 0
    return (monthly_budget * WARMER_SPEND_SHARE_PERCENT) // 100


def month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=UTC)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(year, month + 1, 1, tzinfo=UTC)
    return start, end


def committed_credits(event: UsageEvent) -> int:
    """Credits this row holds against the monthly budget.

    Unknown and still-open reservations keep their hold. They are never folded
    into zero. A released reservation holds nothing.
    """
    if event.released:
        return 0
    if event.credit_status == "known":
        return max(0, int(event.credit_cost))
    hold = event.reservation_credits if event.reservation_credits > 0 else event.credit_cost
    return max(0, int(hold))


def decide_reservation(
    *,
    committed: int,
    warmer_committed: int,
    monthly_budget: int,
    reservation_credits: int,
    endpoint: str,
    priority: CallPriority | None,
    caller: BudgetCaller,
    quota_profile: QuotaProfile,
    explicit_ttl_multiplier: float | None,
) -> BudgetDecision:
    state, warning, pct = evaluate_budget_state(committed, monthly_budget)
    mult = resolve_ttl_multiplier(
        quota_profile,
        state,
        warning_level=warning,
        explicit_override=explicit_ttl_multiplier,
    )
    effective: CallPriority = (
        priority
        if priority is not None
        else ("expensive" if endpoint in EXPENSIVE_ENDPOINTS else "standard")
    )
    ceiling = warmer_credit_ceiling(monthly_budget)
    if caller == "warmer" and warmer_committed + reservation_credits > ceiling:
        return BudgetDecision(
            allowed=False,
            state=state,
            warning_level=warning,
            utilization_pct=pct,
            ttl_multiplier=mult,
            reservation_credits=reservation_credits,
            reason=(
                "Server-key warmer is at its credit ceiling so user requests keep a reserve "
                f"({warmer_committed}+{reservation_credits} > {ceiling})."
            ),
        )
    if monthly_budget <= 0 or state == "CUTOFF" or committed + reservation_credits > monthly_budget:
        return BudgetDecision(
            allowed=False,
            state="CUTOFF",
            warning_level="CUTOFF",
            utilization_pct=pct,
            ttl_multiplier=resolve_ttl_multiplier(
                quota_profile,
                "CUTOFF",
                warning_level="CUTOFF",
                explicit_override=explicit_ttl_multiplier,
            ),
            reservation_credits=reservation_credits,
            reason=(
                "Server-key CMC credit budget reached CUTOFF "
                f"({committed}/{monthly_budget} credits)."
            ),
        )
    if state == "EMERGENCY":
        if effective == "core_warmer" and endpoint in CORE_WARMER_ENDPOINTS:
            return BudgetDecision(
                allowed=True,
                state=state,
                warning_level=warning,
                utilization_pct=pct,
                ttl_multiplier=mult,
                reservation_credits=reservation_credits,
            )
        return BudgetDecision(
            allowed=False,
            state=state,
            warning_level=warning,
            utilization_pct=pct,
            ttl_multiplier=mult,
            reservation_credits=reservation_credits,
            reason=(
                f"Server-key CMC credit budget is in EMERGENCY ({pct:.1f}%); "
                "only core warmer refreshes may miss cache."
            ),
        )
    if state == "CONSERVATION" and effective == "expensive":
        return BudgetDecision(
            allowed=False,
            state=state,
            warning_level=warning,
            utilization_pct=pct,
            ttl_multiplier=mult,
            reservation_credits=reservation_credits,
            reason=(
                f"Server-key CMC budget is in CONSERVATION ({pct:.1f}%); "
                f"expensive endpoint {endpoint} restricted to warm cache or verified snapshot."
            ),
        )
    return BudgetDecision(
        allowed=True,
        state=state,
        warning_level=warning,
        utilization_pct=pct,
        ttl_multiplier=mult,
        reservation_credits=reservation_credits,
    )


def _in_month(event: UsageEvent, year: int, month: int) -> bool:
    if event.created_at is None:
        return False
    stamp = event.created_at
    utc_stamp = stamp.astimezone(UTC) if stamp.tzinfo else stamp.replace(tzinfo=UTC)
    return utc_stamp.year == year and utc_stamp.month == month


def _usage_from_events(events: list[UsageEvent], year: int, month: int) -> MonthUsage:
    credits = 0
    calls = 0
    warmer = 0
    for event in events:
        if not _in_month(event, year, month):
            continue
        held = committed_credits(event)
        credits += held
        calls += 1
        if event.cache_status == "WARMER_MISS":
            warmer += held
    return MonthUsage(credits=credits, calls=calls, warmer_credits=warmer)


class BudgetStore(Protocol):
    async def monthly_totals(self, year: int, month: int) -> MonthUsage: ...

    async def reserve(
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
    ) -> BudgetDecision: ...

    async def reconcile(
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
    ) -> None: ...

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
    ) -> None: ...


class MemoryBudgetStore:
    """Process-local ledger with the same reservation rules as the SQL function.

    A ``threading.Lock`` serializes callers that share this object. It does not
    coordinate separate processes; production uses ``SupabaseBudgetStore``.
    """

    def __init__(self, initial_events: list[UsageEvent] | None = None) -> None:
        self.events: list[UsageEvent] = list(initial_events or [])
        self._lock = threading.Lock()

    async def monthly_totals(self, year: int, month: int) -> MonthUsage:
        with self._lock:
            return _usage_from_events(self.events, year, month)

    async def reserve(
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
        with self._lock:
            return self._reserve_locked(
                idempotency_key=idempotency_key,
                endpoint=endpoint,
                reservation_credits=reservation_credits,
                monthly_budget=monthly_budget,
                priority=priority,
                cache_status=cache_status,
                caller=caller,
                attempt_no=attempt_no,
                quota_profile=quota_profile,
                explicit_ttl_multiplier=explicit_ttl_multiplier,
                now=now,
            )

    def _reserve_locked(
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
        year, month = _month_key(now)
        existing = next(
            (event for event in self.events if event.idempotency_key == idempotency_key),
            None,
        )
        usage = _usage_from_events(self.events, year, month)
        if existing is not None:
            if existing.released:
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
            state, warning, pct = evaluate_budget_state(usage.credits, monthly_budget)
            return BudgetDecision(
                allowed=True,
                state=state,
                warning_level=warning,
                utilization_pct=pct,
                ttl_multiplier=0.0,
                idempotency_key=idempotency_key,
                reservation_credits=existing.reservation_credits or reservation_credits,
            )
        decision = decide_reservation(
            committed=usage.credits,
            warmer_committed=usage.warmer_credits,
            monthly_budget=monthly_budget,
            reservation_credits=reservation_credits,
            endpoint=endpoint,
            priority=priority,
            caller=caller,
            quota_profile=quota_profile,
            explicit_ttl_multiplier=explicit_ttl_multiplier,
        )
        if not decision.allowed:
            return decision
        self.events.append(
            UsageEvent(
                endpoint=endpoint,
                credit_cost=reservation_credits,
                cache_status=cache_status,
                created_at=now,
                credit_status="reserved",
                idempotency_key=idempotency_key,
                reservation_credits=reservation_credits,
                caller=caller,
                attempt_no=attempt_no,
            )
        )
        return replace(decision, idempotency_key=idempotency_key)

    async def reconcile(
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
        with self._lock:
            self._reconcile_locked(
                idempotency_key=idempotency_key,
                outcome=outcome,
                actual_credits=actual_credits,
                error_category=error_category,
                reservation_credits=reservation_credits,
                endpoint=endpoint,
                cache_status=cache_status,
                caller=caller,
                attempt_no=attempt_no,
                now=now,
            )

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
        with self._lock:
            index = next(
                (
                    pos
                    for pos, event in enumerate(self.events)
                    if event.idempotency_key == idempotency_key
                ),
                None,
            )
            if index is None:
                return
            current = self.events[index]
            if current.released or current.credit_status != "reserved":
                return
            hold = current.reservation_credits or current.credit_cost
            self.events[index] = replace(
                current,
                credit_status="unknown",
                credit_cost=max(0, int(hold)),
                error_category=error_category or current.error_category,
            )

    def _reconcile_locked(
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
        index = next(
            (
                pos
                for pos, event in enumerate(self.events)
                if event.idempotency_key == idempotency_key
            ),
            None,
        )
        if index is None:
            if resolved == "released":
                return
            hold = max(0, reservation_credits)
            cost = actual_credits if resolved == "known" and actual_credits is not None else hold
            self.events.append(
                UsageEvent(
                    endpoint=endpoint,
                    credit_cost=max(0, int(cost)),
                    cache_status=cache_status,
                    error_category=error_category,
                    created_at=now,
                    credit_status="known" if resolved == "known" else "unknown",
                    idempotency_key=idempotency_key,
                    reservation_credits=hold,
                    caller=caller,
                    attempt_no=attempt_no,
                )
            )
            return
        current = self.events[index]
        if current.released or current.credit_status == "known":
            return
        if current.credit_status == "unknown" and resolved == "released":
            return
        if resolved == "released":
            self.events[index] = replace(
                current,
                released=True,
                credit_cost=0,
                error_category=error_category or current.error_category,
            )
            return
        if resolved == "unknown":
            hold = current.reservation_credits or current.credit_cost
            self.events[index] = replace(
                current,
                credit_status="unknown",
                credit_cost=max(0, int(hold)),
                reservation_credits=max(0, int(hold)),
                error_category=error_category or current.error_category,
            )
            return
        self.events[index] = replace(
            current,
            credit_status="known",
            credit_cost=max(0, int(actual_credits or 0)),
            error_category=error_category,
        )


def _month_key(dt: datetime) -> tuple[int, int]:
    utc_dt = dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)
    return (utc_dt.year, utc_dt.month)


def _fail_closed_decision(reason: str) -> BudgetDecision:
    return BudgetDecision(
        allowed=False,
        state="CUTOFF",
        warning_level="CUTOFF",
        utilization_pct=None,
        ttl_multiplier=12.0,
        reason=reason,
        ledger_status="unavailable",
    )


class SupabaseBudgetStore:
    """Ledger backed by the aggregate and reservation RPCs in migration 010.

    Rows are not selected into Python. A missing or failed RPC raises
    ``BudgetLedgerUnavailable`` so the controller can fail closed.
    """

    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    def _rpc(self, name: str, params: dict[str, object]) -> Any:
        client = self._client
        if client is None:
            from app.core.db import supabase_client

            client = supabase_client()
        return client.rpc(name, params)

    async def monthly_totals(self, year: int, month: int) -> MonthUsage:
        del year, month  # The RPC bounds the month in UTC itself.

        def read() -> MonthUsage:
            response = self._rpc(TOTALS_RPC, {}).execute()
            rows = response.data or []
            row = rows[0] if isinstance(rows, list) and rows else rows
            if not isinstance(row, dict):
                raise BudgetLedgerUnavailable("empty budget aggregate")
            credits = row.get("credits_committed")
            calls = row.get("upstream_calls")
            warmer = row.get("warmer_credits")
            if credits is None or calls is None or warmer is None:
                raise BudgetLedgerUnavailable("null budget aggregate")
            return MonthUsage(
                credits=max(0, int(credits)),
                calls=max(0, int(calls)),
                warmer_credits=max(0, int(warmer)),
            )

        try:
            return await asyncio.to_thread(read)
        except BudgetLedgerUnavailable:
            raise
        except Exception as exc:
            raise BudgetLedgerUnavailable(exc.__class__.__name__) from exc

    async def reserve(
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
        del quota_profile, explicit_ttl_multiplier, now
        effective = (
            priority
            if priority is not None
            else ("expensive" if endpoint in EXPENSIVE_ENDPOINTS else "standard")
        )

        def write() -> BudgetDecision:
            response = self._rpc(
                RESERVE_RPC,
                {
                    "p_idempotency_key": idempotency_key,
                    "p_endpoint": endpoint,
                    "p_reservation_credits": reservation_credits,
                    "p_monthly_budget": monthly_budget,
                    "p_priority": effective,
                    "p_cache_status": cache_status,
                    "p_caller": caller,
                    "p_attempt_no": attempt_no,
                },
            ).execute()
            rows = response.data or []
            row = rows[0] if isinstance(rows, list) and rows else rows
            if not isinstance(row, dict) or row.get("allowed") is None or row.get("state") is None:
                raise BudgetLedgerUnavailable("empty reservation response")
            return BudgetDecision(
                allowed=bool(row.get("allowed")),
                state=row.get("state") or "CUTOFF",
                warning_level=row.get("warning_level") or "CUTOFF",
                utilization_pct=None,
                ttl_multiplier=0.0,
                reason=row.get("reason"),
                idempotency_key=str(row.get("idempotency_key") or idempotency_key),
                reservation_credits=reservation_credits,
            )

        try:
            return await asyncio.to_thread(write)
        except BudgetLedgerUnavailable:
            raise
        except Exception as exc:
            raise BudgetLedgerUnavailable(exc.__class__.__name__) from exc

    async def reconcile(
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
        del now

        def write() -> None:
            response = self._rpc(
                RECONCILE_RPC,
                {
                    "p_idempotency_key": idempotency_key,
                    "p_outcome": outcome,
                    "p_actual_credits": actual_credits,
                    "p_error_category": error_category,
                    "p_reservation_credits": reservation_credits,
                    "p_endpoint": endpoint,
                    "p_cache_status": cache_status,
                    "p_caller": caller,
                    "p_attempt_no": attempt_no,
                },
            ).execute()
            rows = response.data or []
            row = rows[0] if isinstance(rows, list) and rows else rows
            if not isinstance(row, dict) or row.get("credit_status") is None:
                raise BudgetLedgerUnavailable("empty reconciliation response")

        try:
            await asyncio.to_thread(write)
        except BudgetLedgerUnavailable:
            raise
        except Exception as exc:
            raise BudgetLedgerUnavailable(exc.__class__.__name__) from exc

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
        del now

        def write() -> None:
            client = self._client
            if client is None:
                from app.core.db import supabase_client

                client = supabase_client()
            found = (
                client.table("cmc_usage")
                .select("credit_status,released")
                .eq("idempotency_key", idempotency_key)
                .limit(1)
                .execute()
            )
            rows = found.data or []
            row = rows[0] if isinstance(rows, list) and rows else None
            if (
                not isinstance(row, dict)
                or row.get("released")
                or row.get("credit_status") != "reserved"
            ):
                return
            response = self._rpc(
                RECONCILE_RPC,
                {
                    "p_idempotency_key": idempotency_key,
                    "p_outcome": "unknown",
                    "p_actual_credits": None,
                    "p_error_category": error_category,
                    "p_reservation_credits": 1,
                    "p_endpoint": endpoint,
                    "p_cache_status": cache_status,
                    "p_caller": caller,
                    "p_attempt_no": attempt_no,
                },
            ).execute()
            rows = response.data or []
            answered = rows[0] if isinstance(rows, list) and rows else rows
            if not isinstance(answered, dict) or answered.get("credit_status") is None:
                raise BudgetLedgerUnavailable("empty reconciliation response")

        try:
            await asyncio.to_thread(write)
        except BudgetLedgerUnavailable:
            raise
        except Exception as exc:
            raise BudgetLedgerUnavailable(exc.__class__.__name__) from exc


class BudgetController:
    def __init__(
        self,
        *,
        quota_profile: QuotaProfile = "startup",
        monthly_budget: int | None = None,
        explicit_ttl_multiplier: float | None = None,
        store: BudgetStore | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        from app.core.config import PROFILE_DEFAULT_MONTHLY_BUDGET

        self.quota_profile: QuotaProfile = quota_profile
        self.monthly_budget: int = (
            monthly_budget
            if monthly_budget is not None
            else PROFILE_DEFAULT_MONTHLY_BUDGET[quota_profile]
        )
        self.explicit_ttl_multiplier: float | None = explicit_ttl_multiplier
        self.store: BudgetStore = store if store is not None else MemoryBudgetStore()
        self._now: Callable[[], datetime] = now or (lambda: datetime.now(UTC))

    @classmethod
    def from_settings(
        cls,
        settings: Settings | None = None,
        *,
        store: BudgetStore | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> BudgetController:
        resolved = settings or get_settings()
        return cls(
            quota_profile=resolved.cmc_quota_profile,
            monthly_budget=resolved.resolved_monthly_credit_budget(),
            explicit_ttl_multiplier=resolved.cmc_cache_ttl_multiplier,
            store=store,
            now=now,
        )

    def _unavailable_snapshot(self, now: datetime) -> BudgetSnapshot:
        year, month = _month_key(now)
        return BudgetSnapshot(
            quota_profile=self.quota_profile,
            state="CUTOFF",
            warning_level="CUTOFF",
            billing_month_utc=f"{year:04d}-{month:02d}",
            monthly_budget_credits=self.monthly_budget,
            credits_used_this_month=None,
            remaining_credits=None,
            utilization_pct=None,
            effective_ttl_multiplier=resolve_ttl_multiplier(
                self.quota_profile,
                "CUTOFF",
                warning_level="CUTOFF",
                explicit_override=self.explicit_ttl_multiplier,
            ),
            upstream_calls_this_month=None,
            warmer_credits_this_month=None,
            ledger_status="unavailable",
        )

    async def snapshot(self) -> BudgetSnapshot:
        now = self._now()
        year, month = _month_key(now)
        try:
            usage = await self.store.monthly_totals(year, month)
        except Exception as exc:
            logger.warning("budget ledger read failed (%s); failing closed", exc.__class__.__name__)
            return self._unavailable_snapshot(now)
        state, warning, pct = evaluate_budget_state(usage.credits, self.monthly_budget)
        mult = resolve_ttl_multiplier(
            self.quota_profile,
            state,
            warning_level=warning,
            explicit_override=self.explicit_ttl_multiplier,
        )
        return BudgetSnapshot(
            quota_profile=self.quota_profile,
            state=state,
            warning_level=warning,
            billing_month_utc=f"{year:04d}-{month:02d}",
            monthly_budget_credits=self.monthly_budget,
            credits_used_this_month=usage.credits,
            remaining_credits=max(0, self.monthly_budget - usage.credits),
            utilization_pct=pct,
            effective_ttl_multiplier=mult,
            upstream_calls_this_month=usage.calls,
            warmer_credits_this_month=usage.warmer_credits,
            ledger_status="ok",
        )

    async def summary_dict(self) -> dict[str, object]:
        return (await self.snapshot()).to_dict()

    async def current_ttl_multiplier(self) -> float:
        return (await self.snapshot()).effective_ttl_multiplier

    def _with_ttl(self, decision: BudgetDecision) -> BudgetDecision:
        if decision.ledger_status != "ok" or decision.state not in {
            "NORMAL",
            "CONSERVATION",
            "EMERGENCY",
            "CUTOFF",
        }:
            return decision
        warning = decision.warning_level
        if warning not in {"NONE", "ELEVATED", "CONSERVATION", "EMERGENCY", "CUTOFF"}:
            warning = "CUTOFF"
        mult = resolve_ttl_multiplier(
            self.quota_profile,
            decision.state,
            warning_level=warning,
            explicit_override=self.explicit_ttl_multiplier,
        )
        return replace(decision, ttl_multiplier=mult)

    async def check_upstream_allowed(
        self,
        endpoint: str,
        *,
        priority: CallPriority | None = None,
        caller: BudgetCaller = "user",
    ) -> BudgetDecision:
        """Read-only policy check. The paying gate is ``reserve_upstream``."""
        snap = await self.snapshot()
        if snap.ledger_status != "ok" or snap.credits_used_this_month is None:
            return _fail_closed_decision("CMC credit ledger is unavailable.")
        decision = decide_reservation(
            committed=snap.credits_used_this_month,
            warmer_committed=snap.warmer_credits_this_month or 0,
            monthly_budget=self.monthly_budget,
            reservation_credits=DEFAULT_ATTEMPT_RESERVATION,
            endpoint=endpoint,
            priority=priority,
            caller=caller,
            quota_profile=self.quota_profile,
            explicit_ttl_multiplier=self.explicit_ttl_multiplier,
        )
        return self._with_ttl(decision)

    async def reserve_upstream(
        self,
        *,
        endpoint: str,
        priority: CallPriority | None = None,
        cache_status: UsageCacheStatus = "MISS",
        caller: BudgetCaller = "user",
        reservation_credits: int = DEFAULT_ATTEMPT_RESERVATION,
        attempt_no: int = 1,
        idempotency_key: str | None = None,
    ) -> BudgetDecision:
        key = idempotency_key or f"cmc:{uuid.uuid4().hex}"
        now = self._now()
        try:
            decision = await self.store.reserve(
                idempotency_key=key,
                endpoint=endpoint,
                reservation_credits=max(1, int(reservation_credits)),
                monthly_budget=self.monthly_budget,
                priority=priority,
                cache_status=cache_status,
                caller=caller,
                attempt_no=max(1, int(attempt_no)),
                quota_profile=self.quota_profile,
                explicit_ttl_multiplier=self.explicit_ttl_multiplier,
                now=now,
            )
        except Exception as exc:
            logger.warning(
                "budget reservation failed (%s); failing closed",
                exc.__class__.__name__,
            )
            return _fail_closed_decision("CMC credit ledger is unavailable.")
        return self._with_ttl(decision)

    async def reconcile_upstream(
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
    ) -> None:
        resolved = outcome
        if resolved == "known" and (actual_credits is None or actual_credits < 0):
            resolved = "unknown"
        try:
            await self.store.reconcile(
                idempotency_key=idempotency_key,
                outcome=resolved,
                actual_credits=actual_credits if resolved == "known" else None,
                error_category=error_category,
                reservation_credits=max(0, int(reservation_credits)),
                endpoint=endpoint,
                cache_status=cache_status,
                caller=caller,
                attempt_no=max(1, int(attempt_no)),
                now=self._now(),
            )
        except Exception as exc:
            logger.warning(
                "budget reconciliation failed (%s); reservation hold retained",
                exc.__class__.__name__,
            )

    async def mark_unanswered_reservation(
        self,
        *,
        idempotency_key: str,
        error_category: str | None,
        endpoint: str,
        cache_status: UsageCacheStatus,
        caller: BudgetCaller,
        attempt_no: int,
    ) -> None:
        """Mark a committed reservation unknown. A missing row is left absent."""
        await self.store.mark_existing_unknown(
            idempotency_key=idempotency_key,
            error_category=error_category,
            endpoint=endpoint,
            cache_status=cache_status,
            caller=caller,
            attempt_no=max(1, int(attempt_no)),
            now=self._now(),
        )

    async def record_upstream_call(
        self,
        *,
        endpoint: str,
        credit_cost: int,
        cache_status: UsageCacheStatus = "MISS",
        error_category: str | None = None,
    ) -> None:
        """Compatibility path. Prefer reserve plus reconcile for new call sites."""
        decision = await self.reserve_upstream(
            endpoint=endpoint,
            cache_status=cache_status,
            reservation_credits=max(1, int(credit_cost) if credit_cost > 0 else 1),
        )
        if decision.idempotency_key is None:
            return
        await self.reconcile_upstream(
            idempotency_key=decision.idempotency_key,
            outcome="known",
            actual_credits=max(0, int(credit_cost)),
            error_category=error_category,
            reservation_credits=decision.reservation_credits,
            endpoint=endpoint,
            cache_status=cache_status,
            caller="user",
            attempt_no=1,
        )


_active_budget: BudgetController | None = None


def get_budget_controller() -> BudgetController:
    global _active_budget
    if _active_budget is None:
        _active_budget = BudgetController.from_settings(store=MemoryBudgetStore())
    return _active_budget


def install_budget_controller(controller: BudgetController | None) -> None:
    global _active_budget
    _active_budget = controller


def reset_budget_controller() -> None:
    global _active_budget
    _active_budget = None
