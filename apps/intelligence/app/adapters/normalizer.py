import asyncio
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

_SYMBOL = re.compile(r"^[A-Z0-9]{1,20}$")


@dataclass(frozen=True)
class SymbolResolution:
    ids: dict[str, int]
    limitations: list[str]


def choose_ids(
    symbols: Sequence[str],
    rows: Sequence[Mapping[str, object]],
) -> SymbolResolution:
    requested: list[str] = []
    seen: set[str] = set()
    for symbol in symbols:
        normalized = str(symbol).strip().upper()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        requested.append(normalized)

    grouped: dict[str, dict[int, int | None]] = {}
    for row in rows:
        symbol = str(row.get("symbol", "")).strip().upper()
        cmc_id = row.get("cmc_id")
        if symbol not in seen or not isinstance(cmc_id, int):
            continue
        rank = row.get("rank")
        rank_value = rank if isinstance(rank, int) else None
        current = grouped.setdefault(symbol, {})
        previous = current.get(cmc_id)
        if previous is None or _rank_sort(rank_value) < _rank_sort(previous):
            current[cmc_id] = rank_value

    ids: dict[str, int] = {}
    limitations: list[str] = []
    for symbol in requested:
        candidates = grouped.get(symbol, {})
        if not candidates:
            limitations.append(f"{symbol} was not found in market_assets")
            continue
        best_id = min(candidates, key=lambda cmc_id: _rank_sort(candidates[cmc_id]) + (cmc_id,))
        ids[symbol] = best_id
        if len(candidates) > 1:
            rank = candidates[best_id]
            note = (
                f"{symbol} matched {len(candidates)} assets; "
                f"resolved to cmc_id {best_id} at rank {rank}"
            )
            limitations.append(note)
    return SymbolResolution(ids=ids, limitations=limitations)


async def resolve_symbols_to_ids(
    symbols: list[str],
    rows: Sequence[Mapping[str, object]] | None = None,
) -> SymbolResolution:
    source = rows if rows is not None else await asyncio.to_thread(_load_market_assets, symbols)
    return choose_ids(symbols, source)


def _rank_sort(rank: int | None) -> tuple[int, int]:
    if rank is None:
        return (1, 10**9)
    return (0, rank)


def _load_market_assets(symbols: Sequence[str]) -> list[dict[str, object]]:
    from app.core.db import supabase_client

    safe = []
    seen: set[str] = set()
    for symbol in symbols:
        normalized = str(symbol).strip().upper()
        if normalized in seen or _SYMBOL.fullmatch(normalized) is None:
            continue
        seen.add(normalized)
        safe.append(normalized)
    if not safe:
        return []
    filters = ",".join(f"symbol.ilike.{symbol}" for symbol in safe)
    response = (
        supabase_client()
        .table("market_assets")
        .select("cmc_id,symbol,rank")
        .or_(filters)
        .execute()
    )
    data = response.data or []
    return [row for row in data if isinstance(row, dict)]


def as_float(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return None


def quote_of(asset: Mapping[str, object], currency: str) -> dict[str, object]:
    quote = asset.get("quote")
    if not isinstance(quote, dict):
        return {}
    block = quote.get(currency) or quote.get(currency.upper())
    return block if isinstance(block, dict) else {}


def listing_rows(payload: Mapping[str, object]) -> list[dict[str, object]]:
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict)]


def keyed_assets(payload: Mapping[str, object]) -> list[dict[str, object]]:
    data = payload.get("data")
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        if "quotes" in data or "symbol" in data:
            return [data]
        return [row for row in data.values() if isinstance(row, dict)]
    return []


def map_rows(payload: Mapping[str, object]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for row in listing_rows(payload) or keyed_assets(payload):
        cmc_id = row.get("id")
        if not isinstance(cmc_id, int):
            continue
        rank = row.get("rank")
        if not isinstance(rank, int):
            rank = row.get("cmc_rank")
        rows.append({"cmc_id": cmc_id, "symbol": row.get("symbol"), "rank": rank})
    return rows


def fear_greed(payload: Mapping[str, object]) -> tuple[float | None, str | None]:
    data = payload.get("data")
    row: dict[str, object] | None = None
    if isinstance(data, list) and data and isinstance(data[0], dict):
        row = data[0]
    elif isinstance(data, dict):
        row = data
    if row is None:
        return None, None
    label = row.get("value_classification")
    return as_float(row.get("value")), label if isinstance(label, str) else None


def global_quote(payload: Mapping[str, object], currency: str) -> dict[str, float | None]:
    data = payload.get("data")
    if not isinstance(data, dict):
        return {}
    block = quote_of(data, currency)
    btc_dom = as_float(data.get("btc_dominance"))
    dominance_change = as_float(data.get("btc_dominance_24h_percentage_change"))
    if dominance_change is None:
        prior = as_float(data.get("btc_dominance_yesterday"))
        if (
            btc_dom is not None
            and prior is not None
            and 0.0 <= btc_dom <= 100.0
            and 0.0 <= prior <= 100.0
        ):
            # CMC btc_dominance_24h_percentage_change is percentage-point delta (current - prior)
            dominance_change = btc_dom - prior
    return {
        "total_market_cap": as_float(block.get("total_market_cap")),
        "total_volume_24h": as_float(block.get("total_volume_24h")),
        "total_market_cap_change_24h_pct": as_float(
            block.get("total_market_cap_yesterday_percentage_change")
        ),
        "btc_dominance": btc_dom,
        "eth_dominance": as_float(data.get("eth_dominance")),
        "btc_dominance_change_24h": dominance_change,
    }


@dataclass(frozen=True)
class ParsedDerivatives:
    funding_rate: float | None
    open_interest: float | None
    liquidations_24h: float | None
    market_pair_count: int | None
    sampled_pair_count: int
    open_interest_pairs_included: int
    outlier_pairs_excluded: int
    market_pairs: list[dict[str, object]]
    is_v5_nested: bool
    limitations: list[str]


def parse_derivatives_pairs(
    payload: Mapping[str, object],
    currency: str = "USD",
) -> ParsedDerivatives:
    """Parse CMC v5 nested derivatives market-pairs safely without unsafe cross-exchange merges."""
    data = payload.get("data")
    block: Mapping[str, object]
    if isinstance(data, dict):
        block = data
    elif isinstance(data, list) and data and isinstance(data[0], dict):
        block = data[0]
    else:
        return ParsedDerivatives(
            funding_rate=None,
            open_interest=None,
            liquidations_24h=None,
            market_pair_count=None,
            sampled_pair_count=0,
            open_interest_pairs_included=0,
            outlier_pairs_excluded=0,
            market_pairs=[],
            is_v5_nested=False,
            limitations=["Derivatives payload was empty or malformed."],
        )

    raw_pairs = block.get("market_pairs")
    pair_dicts = (
        [item for item in raw_pairs if isinstance(item, dict)]
        if isinstance(raw_pairs, list)
        else []
    )
    num_pairs_raw = block.get("num_market_pairs")
    reported_total = (
        num_pairs_raw
        if isinstance(num_pairs_raw, int)
        and not isinstance(num_pairs_raw, bool)
        and num_pairs_raw >= 0
        else None
    )

    has_nested_v5 = reported_total is not None or any(
        any(k in item for k in ("quotes", "exchange_reported_quotes", "exchange", "market_id"))
        for item in pair_dicts
    )

    if not has_nested_v5:
        flat_funding = as_float(block.get("funding_rate"))
        flat_oi = as_float(block.get("open_interest"))
        flat_liq = as_float(block.get("liquidations_24h"))
        pair_count = len(raw_pairs) if isinstance(raw_pairs, list) else None
        notes: list[str] = []
        if flat_funding is None and flat_oi is None and flat_liq is None:
            notes.append("Derivatives response contained no extractable metrics.")
        return ParsedDerivatives(
            funding_rate=flat_funding,
            open_interest=flat_oi,
            liquidations_24h=flat_liq,
            market_pair_count=pair_count,
            sampled_pair_count=len(pair_dicts),
            open_interest_pairs_included=1 if flat_oi is not None else 0,
            outlier_pairs_excluded=0,
            market_pairs=[],
            is_v5_nested=False,
            limitations=notes,
        )

    target_currency = currency.strip().upper() or "USD"
    seen_keys: set[object] = set()
    observations: list[dict[str, object]] = []
    oi_sum = 0.0
    oi_included = 0
    outlier_excluded = 0
    outlier_names: list[str] = []
    funding_pair_count = 0

    for idx, pair in enumerate(pair_dicts):
        market_id = pair.get("market_id")
        valid_market_id = (
            market_id
            if isinstance(market_id, int) and not isinstance(market_id, bool)
            else None
        )
        exchange = pair.get("exchange") if isinstance(pair.get("exchange"), dict) else {}
        exchange_id = exchange.get("exchange_id")
        valid_exchange_id = (
            exchange_id
            if isinstance(exchange_id, int) and not isinstance(exchange_id, bool)
            else None
        )
        exchange_name = (
            exchange.get("exchange_name")
            if isinstance(exchange.get("exchange_name"), str)
            else None
        )
        exchange_slug = (
            exchange.get("exchange_slug")
            if isinstance(exchange.get("exchange_slug"), str)
            else None
        )
        pair_symbol = (
            pair.get("market_pair_symbol")
            if isinstance(pair.get("market_pair_symbol"), str)
            else None
        )
        category = pair.get("category") if isinstance(pair.get("category"), str) else None

        dedup_key: object
        if valid_market_id is not None:
            dedup_key = ("market_id", valid_market_id)
        elif valid_exchange_id is not None or pair_symbol is not None:
            dedup_key = ("tuple", valid_exchange_id, pair_symbol, category)
        else:
            dedup_key = ("idx", idx)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        quote_entry = _matching_v5_quote(pair.get("quotes"), target_currency)
        reported_entry = _matching_v5_quote(pair.get("exchange_reported_quotes"), target_currency)

        price = as_float(quote_entry.get("price"))
        if price is None:
            price = as_float(reported_entry.get("price"))
        volume_24h = as_float(quote_entry.get("volume_24h"))
        open_interest = as_float(quote_entry.get("open_interest"))
        if open_interest is None:
            open_interest = as_float(reported_entry.get("open_interest"))
        if open_interest is not None and open_interest < 0:
            open_interest = None

        funding_rate = as_float(reported_entry.get("funding_rate"))
        if funding_rate is None:
            funding_rate = as_float(quote_entry.get("funding_rate"))
        if funding_rate is not None:
            funding_pair_count += 1

        index_price = as_float(reported_entry.get("index_price"))
        index_basis = as_float(reported_entry.get("index_basis"))
        outlier_raw = pair.get("outlier_detected")
        outlier_detected = outlier_raw if isinstance(outlier_raw, bool) else None
        raw_exclusions = pair.get("exclusions")
        exclusions = (
            [str(item) for item in raw_exclusions if isinstance(item, str)]
            if isinstance(raw_exclusions, list)
            else []
        )
        last_updated = quote_entry.get("last_updated") or reported_entry.get("last_updated")
        quote_sym = quote_entry.get("convert_symbol") or reported_entry.get("convert_symbol")

        observations.append(
            {
                "market_id": valid_market_id,
                "exchange_id": valid_exchange_id,
                "exchange_name": exchange_name,
                "exchange_slug": exchange_slug,
                "market_pair_symbol": pair_symbol,
                "category": category,
                "quote_currency": quote_sym if isinstance(quote_sym, str) else None,
                "price": price,
                "volume_24h": volume_24h,
                "open_interest": open_interest,
                "funding_rate": funding_rate,
                "index_price": index_price,
                "index_basis": index_basis,
                "outlier_detected": outlier_detected,
                "exclusions": exclusions,
                "last_updated": last_updated if isinstance(last_updated, str) else None,
            }
        )

        if open_interest is not None:
            if outlier_detected is True:
                outlier_excluded += 1
                if exchange_name:
                    outlier_names.append(exchange_name)
            else:
                oi_sum += open_interest
                oi_included += 1

    total_pairs = reported_total if reported_total is not None else len(observations)
    notes = []
    if not observations:
        notes.append("CoinMarketCap v5 derivatives response returned zero market pairs.")
    else:
        if reported_total is not None and len(observations) < reported_total:
            notes.append(
                f"Sampled {len(observations)} of {reported_total} reported derivative market "
                f"pairs; summed open_interest reflects this sampled subset ({oi_included} "
                f"non-outlier {target_currency} pairs), not market-wide open interest."
            )
        elif oi_included > 0:
            notes.append(
                f"open_interest sums {oi_included} deduplicated non-outlier {target_currency} "
                f"pairs out of {len(observations)} parsed pairs."
            )
        if outlier_excluded > 0:
            label = f" ({', '.join(outlier_names[:5])})" if outlier_names else ""
            notes.append(
                f"Excluded {outlier_excluded} CMC-flagged outlier pair(s){label} from "
                "summed open_interest while preserving them in market_pairs."
            )
        if funding_pair_count > 0:
            notes.append(
                "Cross-exchange funding_rate is not aggregated (left null) because CoinMarketCap "
                "v5 does not expose per-exchange funding intervals; inspect per-pair funding_rate "
                f"across {funding_pair_count} pair(s) in market_pairs."
            )
        else:
            notes.append("No funding_rate values were present in the sampled derivative pairs.")
        notes.append(
            "Asset-level liquidations_24h is unavailable: CoinMarketCap v5 liquidations only "
            "exposes market-wide USD totals, not per-asset attribution."
        )

    return ParsedDerivatives(
        funding_rate=None,
        open_interest=oi_sum if oi_included > 0 else None,
        liquidations_24h=None,
        market_pair_count=total_pairs,
        sampled_pair_count=len(observations),
        open_interest_pairs_included=oi_included,
        outlier_pairs_excluded=outlier_excluded,
        market_pairs=observations,
        is_v5_nested=True,
        limitations=notes,
    )


def _matching_v5_quote(raw_quotes: object, target_currency: str) -> Mapping[str, object]:
    if not isinstance(raw_quotes, list):
        return {}
    for entry in raw_quotes:
        if not isinstance(entry, dict):
            continue
        sym = entry.get("convert_symbol")
        if isinstance(sym, str) and sym.strip().upper() == target_currency:
            return entry
    return {}


def ohlcv_points(payload: Mapping[str, object], currency: str) -> list[tuple[datetime, float]]:
    points: list[tuple[datetime, float]] = []
    for asset in keyed_assets(payload):
        quotes = asset.get("quotes")
        if not isinstance(quotes, list):
            continue
        for quote in quotes:
            if not isinstance(quote, dict):
                continue
            close = as_float(quote_of(quote, currency).get("close"))
            stamp = _parse_time(quote.get("time_close") or quote.get("timestamp"))
            if close is None or stamp is None:
                continue
            points.append((stamp, close))
    return points


def performance_rows(payload: Mapping[str, object], currency: str) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for asset in keyed_assets(payload):
        periods = asset.get("periods")
        if not isinstance(periods, dict):
            continue
        for name, period in periods.items():
            if not isinstance(period, dict):
                continue
            block = quote_of(period, currency)
            rows.append(
                {
                    "period": str(name),
                    "high": as_float(block.get("high")),
                    "low": as_float(block.get("low")),
                    "percent_change": as_float(block.get("percent_change")),
                }
            )
    return rows


def _parse_time(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
