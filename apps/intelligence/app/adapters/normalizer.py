import asyncio
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

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
        supabase_client().table("market_assets").select("cmc_id,symbol,rank").or_(filters).execute()
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
    mcap_now = as_float(block.get("total_market_cap"))
    mcap_prev = as_float(block.get("total_market_cap_yesterday"))
    mcap_change_24h = as_float(block.get("total_market_cap_yesterday_percentage_change"))
    if mcap_now is not None and mcap_prev is not None and mcap_prev > 0.0:
        mcap_change_24h = ((mcap_now / mcap_prev) - 1.0) * 100.0
    return {
        "total_market_cap": mcap_now,
        "total_volume_24h": as_float(block.get("total_volume_24h")),
        "total_market_cap_change_24h_pct": mcap_change_24h,
        "btc_dominance": btc_dom,
        "eth_dominance": as_float(data.get("eth_dominance")),
        "btc_dominance_change_24h": dominance_change,
    }


def global_historical_trends(
    payload: Mapping[str, object],
    currency: str = "USD",
) -> dict[str, float | None]:
    """Compute 7d/30d total market cap % changes and BTC dominance deltas from history."""
    empty: dict[str, float | None] = {
        "total_market_cap_change_7d_pct": None,
        "total_market_cap_change_30d_pct": None,
        "btc_dominance_change_7d": None,
        "btc_dominance_change_30d": None,
    }
    data = payload.get("data")
    quotes: object = data.get("quotes") if isinstance(data, dict) else data
    if not isinstance(quotes, list) or not quotes:
        return empty

    points: list[tuple[datetime, float | None, float | None]] = []
    for idx, entry in enumerate(quotes):
        if not isinstance(entry, dict):
            continue
        ts = _parse_time(entry.get("timestamp"))
        if ts is None:
            ts = datetime.fromtimestamp(idx, tz=UTC)
        block = quote_of(entry, currency)
        mcap = as_float(block.get("total_market_cap"))
        if mcap is None:
            mcap = as_float(entry.get("total_market_cap"))
        btc_dom = as_float(entry.get("btc_dominance"))
        if btc_dom is None:
            btc_dom = as_float(block.get("btc_dominance"))
        points.append((ts, mcap, btc_dom))

    if len(points) < 2:
        return empty
    points.sort(key=lambda item: item[0])

    latest_mcap = points[-1][1]
    latest_dom = points[-1][2]

    def _pct_delta(prior: float | None, current: float | None) -> float | None:
        if prior is None or current is None or prior <= 0:
            return None
        return ((current / prior) - 1.0) * 100.0

    def _pp_delta(prior: float | None, current: float | None) -> float | None:
        if prior is None or current is None:
            return None
        return current - prior

    prior_7 = points[-8] if len(points) >= 8 else (points[0] if len(points) >= 7 else None)
    prior_30 = points[-31] if len(points) >= 31 else (points[0] if len(points) >= 28 else None)

    return {
        "total_market_cap_change_7d_pct": (
            _pct_delta(prior_7[1], latest_mcap) if prior_7 is not None else None
        ),
        "total_market_cap_change_30d_pct": (
            _pct_delta(prior_30[1], latest_mcap) if prior_30 is not None else None
        ),
        "btc_dominance_change_7d": (
            _pp_delta(prior_7[2], latest_dom) if prior_7 is not None else None
        ),
        "btc_dominance_change_30d": (
            _pp_delta(prior_30[2], latest_dom) if prior_30 is not None else None
        ),
    }


def fear_greed_historical_trends(payload: Mapping[str, object]) -> dict[str, float | None]:
    """Compute 7d and 30d Fear & Greed averages and deltas from historical observations."""
    empty: dict[str, float | None] = {
        "fear_greed_avg_7d": None,
        "fear_greed_avg_30d": None,
        "fear_greed_change_7d": None,
        "fear_greed_change_30d": None,
    }
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        return empty

    points: list[tuple[datetime, float]] = []
    for idx, entry in enumerate(data):
        if not isinstance(entry, dict):
            continue
        val = as_float(entry.get("value"))
        if val is None:
            continue
        ts = _parse_time(entry.get("timestamp") or entry.get("update_time"))
        if ts is None:
            ts = datetime.fromtimestamp(idx, tz=UTC)
        points.append((ts, val))

    if not points:
        return empty
    points.sort(key=lambda item: item[0])
    values = [val for _, val in points]
    latest = values[-1]

    avg_7 = sum(values[-7:]) / 7.0 if len(values) >= 7 else None
    avg_30 = sum(values[-30:]) / len(values[-30:]) if len(values) >= 28 else None
    prior_7 = values[-8] if len(values) >= 8 else (values[0] if len(values) >= 7 else None)
    prior_30 = values[-31] if len(values) >= 31 else (values[0] if len(values) >= 28 else None)

    return {
        "fear_greed_avg_7d": avg_7,
        "fear_greed_avg_30d": avg_30,
        "fear_greed_change_7d": (latest - prior_7) if prior_7 is not None else None,
        "fear_greed_change_30d": (latest - prior_30) if prior_30 is not None else None,
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
    *,
    expected_symbol: str | None = None,
    expected_cmc_id: int | None = None,
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
    norm_symbol = expected_symbol.strip().upper() if expected_symbol else None
    seen_keys: set[object] = set()
    observations: list[dict[str, object]] = []
    oi_sum = 0.0
    oi_included = 0
    outlier_excluded = 0
    quote_attributed_excluded = 0
    zero_oi_active_count = 0
    max_oi = 0.0
    max_oi_exchange: str | None = None
    outlier_names: list[str] = []
    funding_pair_count = 0

    for idx, pair in enumerate(pair_dicts):
        market_id = pair.get("market_id")
        valid_market_id = (
            market_id if isinstance(market_id, int) and not isinstance(market_id, bool) else None
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

        base_id_raw = pair.get("base_currency_id") or pair.get("base_id")
        if (
            expected_cmc_id is not None
            and isinstance(base_id_raw, int)
            and not isinstance(base_id_raw, bool)
            and base_id_raw != expected_cmc_id
        ):
            quote_attributed_excluded += 1
            continue
        if norm_symbol is not None and pair_symbol and "/" in pair_symbol:
            base_part = pair_symbol.split("/", 1)[0].strip().upper()
            if base_part and base_part != norm_symbol:
                quote_attributed_excluded += 1
                continue

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
                if open_interest == 0.0 and volume_24h is not None and volume_24h > 0.0:
                    zero_oi_active_count += 1
                if open_interest > max_oi:
                    max_oi = open_interest
                    max_oi_exchange = exchange_name or exchange_slug or pair_symbol

    total_pairs = (
        len(observations)
        if quote_attributed_excluded > 0
        else (reported_total if reported_total is not None else len(observations))
    )
    notes = []
    if quote_attributed_excluded > 0:
        target_label = norm_symbol or "the requested asset"
        notes.append(
            f"Excluded {quote_attributed_excluded} quote-attributed pair(s) where "
            f"{target_label} was the quote currency rather than the base asset."
        )
    if not observations:
        notes.append(
            "CoinMarketCap v5 derivatives response returned zero matching base-asset pairs."
        )
    else:
        if (
            reported_total is not None
            and quote_attributed_excluded == 0
            and len(observations) < reported_total
        ):
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
        if oi_sum > 0.0 and oi_included >= 2 and (max_oi / oi_sum) >= 0.5 and max_oi_exchange:
            notes.append(
                f"High single-venue OI concentration: {max_oi_exchange} accounts for "
                f"{100.0 * max_oi / oi_sum:.1f}% of sampled open_interest."
            )
        if zero_oi_active_count > 0:
            notes.append(
                f"{zero_oi_active_count} sampled pair(s) reported positive 24h volume with "
                "zero open_interest; verify venue reporting quality independently."
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
    target = target_currency.strip().upper()
    for entry in raw_quotes:
        if not isinstance(entry, dict):
            continue
        sym = entry.get("convert_symbol") or entry.get("symbol")
        if isinstance(sym, str) and sym.strip().upper() == target:
            return entry
    return {}


def _non_negative_float(value: object) -> float | None:
    parsed = as_float(value)
    if parsed is None or parsed < 0:
        return None
    return parsed


def _extract_metric(
    quote: Mapping[str, object],
    entry: Mapping[str, object],
    keys: tuple[str, ...],
) -> float | None:
    for source in (quote, entry):
        for k in keys:
            if k in source and source[k] is not None:
                val = _non_negative_float(source[k])
                if val is not None:
                    return val
    return None


def _extract_signed_metric(
    quote: Mapping[str, object],
    entry: Mapping[str, object],
    keys: tuple[str, ...],
) -> float | None:
    for source in (quote, entry):
        for k in keys:
            if k in source and source[k] is not None:
                val = as_float(source[k])
                if val is not None:
                    return val
    return None


def _valid_int(value: object, *, min_value: int = 0) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if value < min_value:
        return None
    return value


@dataclass(frozen=True)
class ParsedMarketLiquidations:
    quote_currency: str
    total_24h: float | None
    long_24h: float | None
    short_24h: float | None
    total_1h: float | None
    total_4h: float | None
    last_updated: str | None
    has_data: bool
    limitations: list[str]


def parse_market_wide_liquidations(
    payload: Mapping[str, object],
    currency: str = "USD",
) -> ParsedMarketLiquidations:
    """Parse CMC v5 market-wide liquidation quotes without attributing them to a single asset."""
    target_currency = currency.strip().upper() or "USD"
    data = payload.get("data")
    if not isinstance(data, (dict, list)) or not data:
        return ParsedMarketLiquidations(
            quote_currency=target_currency,
            total_24h=None,
            long_24h=None,
            short_24h=None,
            total_1h=None,
            total_4h=None,
            last_updated=None,
            has_data=False,
            limitations=["Market-wide liquidations payload was empty or malformed."],
        )

    total_24h: float | None = None
    long_24h: float | None = None
    short_24h: float | None = None
    total_1h: float | None = None
    total_4h: float | None = None
    last_updated: str | None = None

    def _extract_block(block: Mapping[str, object]) -> None:
        nonlocal total_24h, long_24h, short_24h, total_1h, total_4h, last_updated
        if last_updated is None:
            raw_ts = block.get("last_updated") or block.get("timestamp")
            if isinstance(raw_ts, str) and raw_ts.strip():
                last_updated = raw_ts.strip()

        nested_quote = quote_of(block, target_currency)
        sources: list[Mapping[str, object]] = [nested_quote, block] if nested_quote else [block]
        for src in sources:
            if total_24h is None:
                for key in (
                    "total_24h",
                    "liquidations_24h",
                    "total_liquidations_24h",
                    "total_liquidations_usd",
                    "total_liquidations",
                    "total",
                    "volume_24h",
                ):
                    val = _non_negative_float(src.get(key))
                    if val is not None:
                        total_24h = val
                        break
            if long_24h is None:
                for key in (
                    "long_24h",
                    "long_liquidations_24h",
                    "long_liquidations_usd",
                    "long_liquidations",
                    "long",
                ):
                    val = _non_negative_float(src.get(key))
                    if val is not None:
                        long_24h = val
                        break
            if short_24h is None:
                for key in (
                    "short_24h",
                    "short_liquidations_24h",
                    "short_liquidations_usd",
                    "short_liquidations",
                    "short",
                ):
                    val = _non_negative_float(src.get(key))
                    if val is not None:
                        short_24h = val
                        break
            if total_1h is None:
                for key in ("total_1h", "liquidations_1h", "total_liquidations_1h"):
                    val = _non_negative_float(src.get(key))
                    if val is not None:
                        total_1h = val
                        break
            if total_4h is None:
                for key in ("total_4h", "liquidations_4h", "total_liquidations_4h"):
                    val = _non_negative_float(src.get(key))
                    if val is not None:
                        total_4h = val
                        break

    raw_quotes: object = data.get("quotes") if isinstance(data, dict) else data
    if isinstance(raw_quotes, list) and raw_quotes:
        matched_entries: list[Mapping[str, object]] = []
        for entry in raw_quotes:
            if not isinstance(entry, dict):
                continue
            sym = entry.get("convert_symbol") or entry.get("quote_currency")
            if isinstance(sym, str) and sym.strip():
                if sym.strip().upper() == target_currency:
                    matched_entries.append(entry)
            else:
                matched_entries.append(entry)

        # Prefer explicit interval entries if present (e.g. 1h, 4h, 24h)
        interval_handled = False
        for entry in matched_entries:
            interval = entry.get("interval") or entry.get("period") or entry.get("time_period")
            if isinstance(interval, str):
                norm_iv = interval.strip().lower()
                inner = quote_of(entry, target_currency) or entry
                if norm_iv in {"24h", "1d", "daily"}:
                    interval_handled = True
                    _extract_block(inner)
                    if last_updated is None and isinstance(entry.get("timestamp"), str):
                        last_updated = str(entry["timestamp"]).strip()
                elif norm_iv == "1h" and total_1h is None:
                    interval_handled = True
                    total_1h = _non_negative_float(
                        inner.get("total")
                        or inner.get("total_1h")
                        or inner.get("total_liquidations_usd")
                    )
                elif norm_iv == "4h" and total_4h is None:
                    interval_handled = True
                    total_4h = _non_negative_float(
                        inner.get("total")
                        or inner.get("total_4h")
                        or inner.get("total_liquidations_usd")
                    )

        if not interval_handled and matched_entries:
            # Take latest entry by timestamp if multiple chronological snapshots exist
            ordered = sorted(
                matched_entries,
                key=lambda item: (
                    _parse_time(item.get("last_updated") or item.get("timestamp"))
                    or datetime.min.replace(tzinfo=UTC)
                ),
            )
            _extract_block(ordered[-1])
    elif isinstance(raw_quotes, dict) and raw_quotes:
        if target_currency in raw_quotes and isinstance(raw_quotes[target_currency], dict):
            _extract_block(raw_quotes[target_currency])
        if isinstance(raw_quotes.get("24h"), dict):
            _extract_block(raw_quotes["24h"])
        if isinstance(raw_quotes.get("1h"), dict) and total_1h is None:
            total_1h = _non_negative_float(
                raw_quotes["1h"].get("total") or raw_quotes["1h"].get("total_1h")
            )
        if isinstance(raw_quotes.get("4h"), dict) and total_4h is None:
            total_4h = _non_negative_float(
                raw_quotes["4h"].get("total") or raw_quotes["4h"].get("total_4h")
            )
        if total_24h is None and long_24h is None and short_24h is None:
            _extract_block(raw_quotes)
    elif isinstance(data, dict):
        _extract_block(data)

    if last_updated is None and isinstance(data, dict):
        raw_ts = data.get("last_updated") or data.get("timestamp")
        if isinstance(raw_ts, str) and raw_ts.strip():
            last_updated = raw_ts.strip()

    notes: list[str] = []
    if total_24h is None and long_24h is not None and short_24h is not None:
        total_24h = long_24h + short_24h
        notes.append(
            "Market-wide total_24h liquidations was derived by summing observed "
            "long_24h + short_24h liquidation totals."
        )

    has_data = any(
        value is not None for value in (total_24h, long_24h, short_24h, total_1h, total_4h)
    )
    if not has_data:
        notes.append(
            "Market-wide liquidations response contained no extractable finite liquidation metrics."
        )
    else:
        notes.append(
            "market_wide_liquidations reflects observed cross-exchange aggregate liquidations "
            "from /v5/derivatives/liquidations/quotes/latest and is NOT attributable to an "
            "individual asset (asset-level liquidations_24h remains null)."
        )
        if long_24h is None or short_24h is None:
            notes.append(
                "Market-wide long/short 24h liquidation breakdown was incomplete; "
                "missing side(s) left null."
            )

    return ParsedMarketLiquidations(
        quote_currency=target_currency,
        total_24h=total_24h,
        long_24h=long_24h,
        short_24h=short_24h,
        total_1h=total_1h,
        total_4h=total_4h,
        last_updated=last_updated,
        has_data=has_data,
        limitations=notes,
    )


@dataclass(frozen=True)
class ParsedDerivativesVenues:
    quote_currency: str
    total_exchanges: int | None
    sampled_exchanges: int
    total_open_interest: float | None
    total_volume_24h: float | None
    venues: list[dict[str, object]]
    limitations: list[str]


def parse_derivatives_exchanges(
    payload: Mapping[str, object],
    currency: str = "USD",
) -> ParsedDerivativesVenues:
    """Parse CMC v5 /v5/exchange/derivatives/list safely with deduplication by exchange ID."""
    target_currency = currency.strip().upper() or "USD"
    data = payload.get("data")
    raw_exchanges: object = None
    total_reported: int | None = None
    if isinstance(data, dict):
        raw_exchanges = data.get("exchanges")
        total_reported = _valid_int(data.get("total_count"))
        if total_reported is None:
            total_reported = _valid_int(data.get("total_size"))
    elif isinstance(data, list):
        raw_exchanges = data

    if not isinstance(raw_exchanges, list) or not raw_exchanges:
        return ParsedDerivativesVenues(
            quote_currency=target_currency,
            total_exchanges=total_reported,
            sampled_exchanges=0,
            total_open_interest=None,
            total_volume_24h=None,
            venues=[],
            limitations=["Derivatives exchanges payload was empty or malformed."],
        )

    seen_keys: set[object] = set()
    venues: list[dict[str, object]] = []
    oi_sum = 0.0
    oi_count = 0
    vol_sum = 0.0
    vol_count = 0

    for idx, entry in enumerate(raw_exchanges):
        if not isinstance(entry, dict):
            continue
        ex_id = _valid_int(
            entry.get("id") if "id" in entry else entry.get("exchange_id"), min_value=1
        )
        name_raw = entry.get("exchange_name") or entry.get("name")
        name = name_raw.strip() if isinstance(name_raw, str) and name_raw.strip() else None
        slug_raw = entry.get("exchange_slug") or entry.get("slug")
        slug = slug_raw.strip() if isinstance(slug_raw, str) and slug_raw.strip() else None
        dedup_key: object = ("id", ex_id) if ex_id is not None else ("name", name, slug, idx)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        quote_entry: Mapping[str, object] = quote_of(entry, target_currency)
        if not quote_entry:
            quote_entry = _matching_v5_quote(entry.get("quotes"), target_currency)

        vol_24h = _extract_metric(quote_entry, entry, ("derivative_volume_usd", "volume_24h"))
        vol_adj = _extract_metric(quote_entry, entry, ("volume_24h_adjusted",))
        oi = _extract_metric(quote_entry, entry, ("open_interest_usd", "open_interest"))
        last_updated = quote_entry.get("last_updated") or entry.get("last_updated")

        if oi is not None:
            oi_sum += oi
            oi_count += 1
        if vol_24h is not None:
            vol_sum += vol_24h
            vol_count += 1

        venues.append(
            {
                "exchange_id": ex_id,
                "name": name,
                "slug": slug,
                "rank": _valid_int(entry.get("rank"), min_value=1),
                "num_market_pairs": _valid_int(entry.get("num_market_pairs")),
                "exchange_score": as_float(entry.get("exchange_score")),
                "liquidity_score": as_float(entry.get("liquidity_score")),
                "volume_24h": vol_24h,
                "volume_24h_adjusted": vol_adj,
                "open_interest": oi,
                "last_updated": last_updated if isinstance(last_updated, str) else None,
            }
        )

    if not venues:
        return ParsedDerivativesVenues(
            quote_currency=target_currency,
            total_exchanges=total_reported,
            sampled_exchanges=0,
            total_open_interest=None,
            total_volume_24h=None,
            venues=[],
            limitations=["Derivatives exchanges payload contained zero valid exchange objects."],
        )

    venues.sort(
        key=lambda row: (
            -(row["volume_24h"] if isinstance(row["volume_24h"], float) else -1.0),
            row["rank"] if isinstance(row["rank"], int) else 10**9,
        )
    )
    total_exchanges = total_reported
    notes: list[str] = [
        "derivatives_venues summarizes market-wide derivatives exchanges from "
        "/v5/exchange/derivatives/list and is not asset-specific."
    ]
    if total_reported is not None and len(venues) < total_reported:
        notes.append(
            f"Sampled {len(venues)} of {total_reported} derivatives exchanges; venue open "
            "interest and volume sums reflect this sampled subset only."
        )

    return ParsedDerivativesVenues(
        quote_currency=target_currency,
        total_exchanges=total_exchanges,
        sampled_exchanges=len(venues),
        total_open_interest=oi_sum if oi_count > 0 else None,
        total_volume_24h=vol_sum if vol_count > 0 else None,
        venues=venues[:10],
        limitations=notes,
    )


@dataclass(frozen=True)
class ParsedRwaUniverse:
    total_rwa_assets: int | None
    sampled_rwa_assets: int
    asset_type_counts: dict[str, int]
    total_tokenized_market_cap: float | None
    total_tokenized_volume_24h: float | None
    top_rwa_assets: list[dict[str, object]]
    limitations: list[str]


def parse_rwa_universe(
    list_payload: Mapping[str, object] | None,
    map_payload: Mapping[str, object] | None = None,
    currency: str = "USD",
) -> ParsedRwaUniverse:
    """Parse CMC v5 RWA endpoints by rwa_id, kept separate from crypto sector cmc_id metrics."""
    target_currency = currency.strip().upper() or "USD"
    map_by_id: dict[int, Mapping[str, object]] = {}
    map_total: int | None = None
    if isinstance(map_payload, Mapping):
        mdata = map_payload.get("data")
        if isinstance(mdata, Mapping):
            map_total = _valid_int(mdata.get("total_size"))
            if map_total is None:
                map_total = _valid_int(mdata.get("total_count"))
            raw_map = mdata.get("rwa_assets")
        else:
            raw_map = mdata
        if isinstance(raw_map, list):
            for item in raw_map:
                if not isinstance(item, dict):
                    continue
                rid = _valid_int(item.get("rwa_id") or item.get("id"), min_value=1)
                if rid is not None:
                    map_by_id[rid] = item

    list_rows: list[dict[str, object]] = []
    list_total: int | None = None
    if isinstance(list_payload, Mapping):
        ldata = list_payload.get("data")
        if isinstance(ldata, Mapping):
            list_total = _valid_int(ldata.get("total_size"))
            if list_total is None:
                list_total = _valid_int(ldata.get("total_count"))
            raw_list = ldata.get("rwa_assets")
        else:
            raw_list = ldata
        if isinstance(raw_list, list):
            list_rows = [item for item in raw_list if isinstance(item, dict)]

    # Fall back to map entries if asset list was empty/unavailable while map succeeded
    source_rows: list[Mapping[str, object]] = list_rows if list_rows else list(map_by_id.values())
    total_reported = list_total if list_total is not None else map_total

    if not source_rows:
        return ParsedRwaUniverse(
            total_rwa_assets=total_reported,
            sampled_rwa_assets=0,
            asset_type_counts={},
            total_tokenized_market_cap=None,
            total_tokenized_volume_24h=None,
            top_rwa_assets=[],
            limitations=["CMC v5 RWA payload was empty or malformed."],
        )

    seen_keys: set[object] = set()
    parsed_assets: list[dict[str, object]] = []
    type_counts: dict[str, int] = {}
    mcap_sum = 0.0
    mcap_count = 0
    vol_sum = 0.0
    vol_count = 0

    for idx, entry in enumerate(source_rows):
        rid = _valid_int(entry.get("rwa_id") or entry.get("id"), min_value=1)
        meta = map_by_id.get(rid, {}) if rid is not None else {}

        symbol_raw = entry.get("symbol") or meta.get("symbol")
        name_raw = entry.get("name") or meta.get("name")
        symbol = (
            symbol_raw.strip().upper()
            if isinstance(symbol_raw, str) and symbol_raw.strip()
            else None
        )
        name = name_raw.strip() if isinstance(name_raw, str) and name_raw.strip() else None
        dedup_key: object = ("rwa_id", rid) if rid is not None else ("sym_name", symbol, name, idx)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        asset_type_raw = entry.get("asset_type") or meta.get("asset_type")
        asset_type = (
            asset_type_raw.strip().lower()
            if isinstance(asset_type_raw, str) and asset_type_raw.strip()
            else None
        )
        if asset_type:
            type_counts[asset_type] = type_counts.get(asset_type, 0) + 1

        rank = _valid_int(entry.get("rwa_rank") or meta.get("rwa_rank"), min_value=1)
        has_tokens_raw = (
            entry.get("has_tokens") if "has_tokens" in entry else meta.get("has_tokens")
        )
        has_tokens = has_tokens_raw if isinstance(has_tokens_raw, bool) else None

        quote_entry: Mapping[str, object] = quote_of(entry, target_currency)
        if not quote_entry:
            quote_entry = _matching_v5_quote(entry.get("quotes"), target_currency)

        price = _extract_metric(quote_entry, entry, ("average_tokenized_price", "price"))
        mcap = _extract_metric(quote_entry, entry, ("tokenized_market_cap", "market_cap"))
        vol = _extract_metric(quote_entry, entry, ("tokenized_volume_24h", "volume_24h"))
        c24 = _extract_signed_metric(quote_entry, entry, ("percent_change_24h",))
        c7 = _extract_signed_metric(quote_entry, entry, ("percent_change_7d",))
        last_updated = quote_entry.get("last_updated") or entry.get("last_updated")

        if mcap is not None:
            mcap_sum += mcap
            mcap_count += 1
        if vol is not None:
            vol_sum += vol
            vol_count += 1

        parsed_assets.append(
            {
                "rwa_id": rid,
                "symbol": symbol,
                "name": name,
                "asset_type": asset_type,
                "rwa_rank": rank,
                "has_tokens": has_tokens,
                "price": price,
                "market_cap": mcap,
                "volume_24h": vol,
                "percent_change_24h": c24,
                "percent_change_7d": c7,
                "last_updated": last_updated if isinstance(last_updated, str) else None,
            }
        )

    parsed_assets.sort(
        key=lambda row: (
            -(row["market_cap"] if isinstance(row["market_cap"], float) else -1.0),
            row["rwa_rank"] if isinstance(row["rwa_rank"], int) else 10**9,
        )
    )
    total_assets = total_reported if total_reported is not None else len(parsed_assets)
    notes: list[str] = [
        "rwa_universe reflects underlying tokenized real-world assets keyed by CMC rwa_id "
        "(/v5/real-world-assets/*) and is kept strictly separate from crypto RWA protocol "
        "sector aggregates."
    ]
    if total_reported is not None and len(parsed_assets) < total_reported:
        notes.append(
            f"Sampled {len(parsed_assets)} of {total_reported} tracked RWA assets; "
            "tokenized market cap and volume totals reflect this sampled subset only."
        )
    if not list_rows and map_by_id:
        notes.append(
            "Only /v5/real-world-assets/map metadata was available; tokenized pricing and "
            "market-cap fields remain null."
        )

    return ParsedRwaUniverse(
        total_rwa_assets=total_assets,
        sampled_rwa_assets=len(parsed_assets),
        asset_type_counts=dict(sorted(type_counts.items())),
        total_tokenized_market_cap=mcap_sum if mcap_count > 0 else None,
        total_tokenized_volume_24h=vol_sum if vol_count > 0 else None,
        top_rwa_assets=parsed_assets[:10],
        limitations=notes,
    )


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


def parse_v3_quotes_historical(
    payload: Mapping[str, object],
    currency: str = "USD",
) -> dict[int, list[dict[str, object]]]:
    """Parse CMC /v3/cryptocurrency/quotes/historical keyed by numeric cmc_id."""
    parsed: dict[int, list[dict[str, object]]] = {}
    target = currency.strip().upper() or "USD"
    for asset in keyed_assets(payload):
        raw_id = asset.get("id")
        if not isinstance(raw_id, int) or isinstance(raw_id, bool):
            continue
        quotes = asset.get("quotes")
        if not isinstance(quotes, list):
            continue
        bars: list[dict[str, object]] = []
        for entry in quotes:
            if not isinstance(entry, dict):
                continue
            stamp = _parse_time(entry.get("timestamp"))
            block = quote_of(entry, target)
            price = as_float(block.get("price"))
            if stamp is None or price is None or price <= 0.0:
                continue
            bars.append(
                {
                    "timestamp": stamp,
                    "close": price,
                    "volume": as_float(block.get("volume_24h")),
                    "market_cap": as_float(block.get("market_cap")),
                }
            )
        if bars:
            bars.sort(key=lambda b: b["timestamp"])  # type: ignore[arg-type,return-value]
            parsed[raw_id] = bars
    return parsed


def parse_ohlcv_bars(
    payload: Mapping[str, object],
    currency: str = "USD",
) -> dict[int, list[dict[str, object]]]:
    """Parse CMC /v2/cryptocurrency/ohlcv/historical bars keyed by numeric cmc_id."""
    parsed: dict[int, list[dict[str, object]]] = {}
    target = currency.strip().upper() or "USD"
    for asset in keyed_assets(payload):
        raw_id = asset.get("id")
        if not isinstance(raw_id, int) or isinstance(raw_id, bool):
            continue
        quotes = asset.get("quotes")
        if not isinstance(quotes, list):
            continue
        bars: list[dict[str, object]] = []
        for entry in quotes:
            if not isinstance(entry, dict):
                continue
            stamp = _parse_time(entry.get("time_close") or entry.get("timestamp"))
            block = quote_of(entry, target)
            close = as_float(block.get("close"))
            if stamp is None or close is None or close <= 0.0:
                continue
            bars.append(
                {
                    "timestamp": stamp,
                    "open": as_float(block.get("open")),
                    "high": as_float(block.get("high")),
                    "low": as_float(block.get("low")),
                    "close": close,
                    "volume": as_float(block.get("volume")),
                }
            )
        if bars:
            bars.sort(key=lambda b: b["timestamp"])  # type: ignore[arg-type,return-value]
            parsed[raw_id] = bars
    return parsed


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
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        try:
            return datetime.fromtimestamp(float(value), tz=UTC)
        except (OSError, OverflowError, ValueError):
            return None
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if cleaned.isdigit():
        try:
            return datetime.fromtimestamp(int(cleaned), tz=UTC)
        except (OSError, OverflowError, ValueError):
            return None
    try:
        parsed = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
        return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None
