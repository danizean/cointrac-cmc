"""Disposable PostgreSQL 16 checks for the budget ledger and daily-close guards.

These tests are not run in the default suite. They refuse a Supabase host.
Nothing here was executed against production.

Prepare a local, empty database:

    createdb cointrac_ledger_test
    pip install "psycopg[binary]"
    set COINTRAC_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/cointrac_ledger_test
    python -m pytest -q tests/test_postgres_budget_integration.py

The fixture applies migrations 009, 011, 012, and 010, then drops those objects.
Do not point COINTRAC_TEST_DATABASE_URL at a database that already stores
real ledger or close rows.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "supabase" / "migrations"
DSN = os.environ.get("COINTRAC_TEST_DATABASE_URL", "").strip()
_FORBIDDEN = ("supabase.co", "fflwfpmbyykyxhlhikwc", "udprwjbmrfknulngsjid")

pytestmark = pytest.mark.skipif(
    not DSN,
    reason="COINTRAC_TEST_DATABASE_URL is not set; disposable Postgres was not run",
)


def _require_disposable_dsn() -> str:
    lowered = DSN.lower()
    if any(token in lowered for token in _FORBIDDEN):
        pytest.fail("COINTRAC_TEST_DATABASE_URL points at a hosted Supabase database")
    return DSN


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def pg_conn():
    psycopg = pytest.importorskip("psycopg")
    dsn = _require_disposable_dsn()
    conn = psycopg.connect(dsn, autocommit=True)
    conn.execute("CREATE SCHEMA IF NOT EXISTS private")
    for name in (
        "009_daily_asset_closes.sql",
        "011_daily_asset_closes_immutable.sql",
        "012_daily_asset_closes_no_delete.sql",
        "010_cmc_budget_integrity.sql",
    ):
        conn.execute(_sql(name))
    conn.execute(
        """
        DO $$ BEGIN
            CREATE ROLE service_role NOLOGIN BYPASSRLS;
        EXCEPTION WHEN duplicate_object THEN
            ALTER ROLE service_role NOLOGIN BYPASSRLS;
        END $$;
        GRANT service_role TO CURRENT_USER;
        """
    )
    try:
        yield conn
    finally:
        conn.execute("DROP TABLE IF EXISTS public.daily_asset_closes CASCADE")
        conn.execute("DROP TABLE IF EXISTS public.cmc_usage CASCADE")
        conn.execute("DROP FUNCTION IF EXISTS public.cointrac_reserve_cmc_credit")
        conn.execute("DROP FUNCTION IF EXISTS public.cointrac_reconcile_cmc_credit")
        conn.execute("DROP FUNCTION IF EXISTS public.cointrac_cmc_budget_totals")
        conn.execute("DROP FUNCTION IF EXISTS private.prevent_daily_asset_close_delete")
        conn.execute("DROP FUNCTION IF EXISTS private.prevent_daily_asset_close_update")
        conn.close()


def _clear_usage(conn) -> None:
    conn.execute("DELETE FROM public.cmc_usage")


def _reserve(conn, key: str, budget: int = 1) -> bool:
    row = conn.execute(
        """
        SELECT allowed
        FROM public.cointrac_reserve_cmc_credit(
            %s, '/v2/cryptocurrency/quotes/latest', 1, %s,
            'standard', 'MISS', 'user', 1
        )
        """,
        (key, budget),
    ).fetchone()
    assert row is not None
    return bool(row[0])


def test_concurrent_reservations_cannot_pass_one_credit(pg_conn) -> None:
    from concurrent.futures import ThreadPoolExecutor

    psycopg = pytest.importorskip("psycopg")
    dsn = _require_disposable_dsn()
    _clear_usage(pg_conn)

    def once(key: str) -> bool:
        with psycopg.connect(dsn, autocommit=True) as conn:
            return _reserve(conn, key, budget=1)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(once, ("cmc:pg-a", "cmc:pg-b")))
    assert results.count(True) == 1
    pg_conn.execute("DELETE FROM public.cmc_usage WHERE idempotency_key LIKE 'cmc:pg-%'")


def test_same_idempotency_key_does_not_double_charge(pg_conn) -> None:
    _clear_usage(pg_conn)
    assert _reserve(pg_conn, "cmc:pg-same", budget=10) is True
    assert _reserve(pg_conn, "cmc:pg-same", budget=10) is True
    count = pg_conn.execute(
        "SELECT count(*) FROM public.cmc_usage WHERE idempotency_key = 'cmc:pg-same'"
    ).fetchone()
    assert count is not None and count[0] == 1
    pg_conn.execute("DELETE FROM public.cmc_usage WHERE idempotency_key = 'cmc:pg-same'")


def test_unknown_hold_and_known_reconcile(pg_conn) -> None:
    _clear_usage(pg_conn)
    assert _reserve(pg_conn, "cmc:pg-hold", budget=10) is True
    unknown = pg_conn.execute(
        """
        SELECT credit_status, credit_cost, released
        FROM public.cointrac_reconcile_cmc_credit(
            'cmc:pg-hold', 'unknown', NULL, 'transient_error', 1,
            '/v2/cryptocurrency/quotes/latest', 'MISS', 'user', 1
        )
        """
    ).fetchone()
    assert unknown == ("unknown", 1, False)
    released = pg_conn.execute(
        """
        SELECT credit_status, released
        FROM public.cointrac_reconcile_cmc_credit(
            'cmc:pg-hold', 'released', NULL, 'transient_error', 1,
            '/v2/cryptocurrency/quotes/latest', 'MISS', 'user', 1
        )
        """
    ).fetchone()
    assert released == ("unknown", False)
    assert _reserve(pg_conn, "cmc:pg-known", budget=10) is True
    known = pg_conn.execute(
        """
        SELECT credit_status, credit_cost, released
        FROM public.cointrac_reconcile_cmc_credit(
            'cmc:pg-known', 'known', 2, NULL, 1,
            '/v2/cryptocurrency/quotes/latest', 'MISS', 'user', 1
        )
        """
    ).fetchone()
    assert known == ("known", 2, False)
    pg_conn.execute(
        "DELETE FROM public.cmc_usage WHERE idempotency_key IN ('cmc:pg-hold', 'cmc:pg-known')"
    )


def test_service_role_cannot_delete_or_update_daily_close_but_can_insert(pg_conn) -> None:
    pg_conn.execute("SET ROLE service_role")
    try:
        pg_conn.execute(
            """
            INSERT INTO public.daily_asset_closes
                (cmc_id, utc_date, close_price, source)
            VALUES (1, DATE '2026-11-25', 10, 'cmc_listings_snapshot_observed_reference')
            """
        )
        with pytest.raises(Exception, match="cannot be deleted|permission denied"):
            pg_conn.execute(
                """
                DELETE FROM public.daily_asset_closes
                WHERE cmc_id = 1 AND utc_date = DATE '2026-11-25'
                """
            )
        with pytest.raises(Exception, match="immutable|permission denied"):
            pg_conn.execute(
                """
                UPDATE public.daily_asset_closes
                SET close_price = 11
                WHERE cmc_id = 1 AND utc_date = DATE '2026-11-25'
                """
            )
        pg_conn.execute(
            """
            INSERT INTO public.daily_asset_closes
                (cmc_id, utc_date, close_price, source)
            VALUES (1, DATE '2026-11-25', 99, 'cmc_listings_snapshot_observed_reference')
            ON CONFLICT (cmc_id, utc_date) DO NOTHING
            """
        )
        price = pg_conn.execute(
            """
            SELECT close_price FROM public.daily_asset_closes
            WHERE cmc_id = 1 AND utc_date = DATE '2026-11-25'
            """
        ).fetchone()
        assert price is not None and price[0] == 10
    finally:
        pg_conn.execute("RESET ROLE")
