"""Deterministic UI summary cards, tables, sparklines, and normalized metrics for CoinTrac AI."""

from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ToneLiteral = Literal["positive", "warning", "destructive", "info", "neutral"]


class AIHeadlineChip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    sublabel: str | None = None
    tone: ToneLiteral = "neutral"
    data_mode: str | None = None
    source_timestamp: str | None = None
    evidence_id: str | None = None


class AIKpiMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    value: str
    sub: str | None = None
    tone: ToneLiteral = "neutral"
    data_mode: str | None = None
    source_timestamp: str | None = None
    evidence_id: str | None = None


class AITableCell(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    tone: ToneLiteral = "neutral"


class AIStructuredTable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    columns: list[str]
    rows: list[list[AITableCell]]


class AISparkline(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    points: list[float]
    point_labels: list[str]
    tone: ToneLiteral = "neutral"


class AIDetailItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    value: str
    note: str | None = None


class AIStructuredSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline_chip: AIHeadlineChip | None = None
    kpis: list[AIKpiMetric] = Field(default_factory=list)
    tables: list[AIStructuredTable] = Field(default_factory=list)
    sparkline: AISparkline | None = None
    details: list[AIDetailItem] = Field(default_factory=list)
    limitations_line: str | None = None


def _num(val: Any) -> float | None:
    if isinstance(val, bool) or val is None:
        return None
    if isinstance(val, int | float) and math.isfinite(float(val)):
        return float(val)
    return None


def _currency_prefix(code: str | None) -> str:
    upper = (code or "USD").strip().upper()
    return {
        "USD": "$",
        "USDT": "$",
        "USDC": "$",
        "EUR": "€",
        "GBP": "£",
        "JPY": "¥",
        "BTC": "₿",
        "ETH": "Ξ",
    }.get(upper, f"{upper} ")


def fmt_pct(val: Any, *, signed: bool = True) -> str:
    n = _num(val)
    if n is None:
        return "—"
    prefix = "+" if signed and n > 0 else ""
    return f"{prefix}{n:.1f}%"


def fmt_price(val: Any, quote: str | None = "USD") -> str:
    n = _num(val)
    if n is None:
        return "—"
    prefix = _currency_prefix(quote)
    sign = "-" if n < 0 else ""
    abs_n = abs(n)
    if (quote or "USD").strip().upper() in {"BTC", "ETH"}:
        decimals = 4 if abs_n < 1 else 2
        return f"{sign}{prefix}{abs_n:,.{decimals}f}"
    if abs_n >= 0.1 or abs_n == 0:
        return f"{sign}{prefix}{abs_n:,.2f}"
    if abs_n >= 0.001:
        return f"{sign}{prefix}{abs_n:.4f}"
    return f"{sign}{prefix}{abs_n:.6f}"


def fmt_compact(val: Any, quote: str | None = "USD") -> str:
    n = _num(val)
    if n is None:
        return "—"
    prefix = _currency_prefix(quote)
    sign = "-" if n < 0 else ""
    abs_n = abs(n)
    if abs_n >= 1_000_000_000_000:
        return f"{sign}{prefix}{abs_n / 1_000_000_000_000:.2f}T"
    if abs_n >= 1_000_000_000:
        return f"{sign}{prefix}{abs_n / 1_000_000_000:.2f}B"
    if abs_n >= 1_000_000:
        return f"{sign}{prefix}{abs_n / 1_000_000:.2f}M"
    if abs_n >= 1_000:
        return f"{sign}{prefix}{abs_n / 1_000:.2f}K"
    return f"{sign}{prefix}{abs_n:.2f}"


def fmt_score(val: Any) -> str:
    n = _num(val)
    return f"{n:.1f}" if n is not None else "—"


def fmt_ratio(val: Any) -> str:
    n = _num(val)
    return f"{n:.2f}" if n is not None else "—"


def _pct_tone(val: Any) -> ToneLiteral:
    n = _num(val)
    if n is None or abs(n) < 0.05:
        return "neutral"
    return "positive" if n > 0 else "destructive"


def _regime_tone(regime: str | None) -> ToneLiteral:
    upper = (regime or "").upper()
    if "RISK_OFF" in upper or "STRESS" in upper:
        return "destructive"
    if "RISK_ON" in upper or "ALTSEASON" in upper or "EXPANSION" in upper:
        return "positive"
    if "CONSOLIDATION" in upper or "RANGE" in upper:
        return "warning"
    return "info"


def _fg_tone(val: Any) -> ToneLiteral:
    n = _num(val)
    if n is None:
        return "neutral"
    if n <= 25:
        return "destructive"
    if n <= 45:
        return "warning"
    if n >= 60:
        return "positive"
    return "info"


def _extract_primary_ts(evidence: dict[str, Any]) -> str | None:
    src = evidence.get("source_timestamps")
    if isinstance(src, dict):
        for val in src.values():
            if isinstance(val, str) and val.strip():
                return val.strip()
    retrieved = evidence.get("retrieved_at_utc")
    return str(retrieved).strip() if isinstance(retrieved, str) and retrieved.strip() else None


def _build_asset_sparkline(
    symbol: str,
    row: dict[str, Any],
    *,
    is_id: bool,
) -> AISparkline | None:
    """Derive an indexed trajectory (Base 100) cleanly from real multi-timeframe % changes."""
    c30 = _num(row.get("percent_change_30d"))
    c7 = _num(row.get("percent_change_7d"))
    c24 = _num(row.get("percent_change_24h"))
    if c7 is None or c24 is None:
        return None
    # Reconstruct past index levels strictly from observed cumulative % returns ending at 100.
    end = 100.0
    p_24h = end / (1.0 + c24 / 100.0) if (1.0 + c24 / 100.0) > 0.05 else None
    p_7d = end / (1.0 + c7 / 100.0) if (1.0 + c7 / 100.0) > 0.05 else None
    if p_24h is None or p_7d is None:
        return None
    pts: list[float] = []
    labels: list[str] = []
    if c30 is not None and (1.0 + c30 / 100.0) > 0.05:
        p_30d = end / (1.0 + c30 / 100.0)
        pts.append(round(p_30d, 2))
        labels.append("30d")
    pts.extend([round(p_7d, 2), round(p_24h, 2), round(end, 2)])
    labels.extend(["7d", "24h", "Now" if not is_id else "Kini"])
    return AISparkline(
        label=f"{symbol} Indexed Path" if not is_id else f"Jalur Indeks {symbol}",
        points=pts,
        point_labels=labels,
        tone=_pct_tone(c7),
    )


def build_structured_summary(
    envelopes: list[dict[str, Any]],
    *,
    locale: Literal["en", "id"] = "id",
) -> AIStructuredSummary | None:
    """Build deterministic visual cards, tables, sparkline, and accordion items from envelopes."""
    if not envelopes:
        return None

    is_id = locale == "id"
    by_tool: dict[str, dict[str, Any]] = {}
    limitation_notes: list[str] = []
    evidence_tags: list[str] = []

    for env in envelopes:
        tool_name = str(env.get("tool") or "")
        if not tool_name:
            continue
        by_tool[tool_name] = env
        ev = env.get("evidence") if isinstance(env.get("evidence"), dict) else {}
        ev_id = ev.get("evidence_id")
        mode = ev.get("data_mode")
        if ev_id:
            tag = f"{ev_id} ({mode or 'UNKNOWN'})"
            if tag not in evidence_tags:
                evidence_tags.append(tag)
        for note in env.get("limitations") or []:
            if isinstance(note, str) and note.strip() and note.strip() not in limitation_notes:
                limitation_notes.append(note.strip())

    headline_chip: AIHeadlineChip | None = None
    kpis: list[AIKpiMetric] = []
    tables: list[AIStructuredTable] = []
    sparkline: AISparkline | None = None
    details: list[AIDetailItem] = []

    def add_kpi(item: AIKpiMetric) -> None:
        if len(kpis) < 4:
            kpis.append(item)

    # 1. Market Regime Headline Chip
    regime_env = by_tool.get("analyze_market_regime")
    if regime_env:
        rdata = regime_env.get("data") if isinstance(regime_env.get("data"), dict) else {}
        rev = regime_env.get("evidence") if isinstance(regime_env.get("evidence"), dict) else {}
        regime_val = rdata.get("regime")
        conf_val = rdata.get("confidence")
        if regime_val:
            headline_chip = AIHeadlineChip(
                label=str(regime_val),
                sublabel=f"Conf: {conf_val}" if conf_val else None,
                tone=_regime_tone(str(regime_val)),
                data_mode=str(rev.get("data_mode") or ""),
                source_timestamp=_extract_primary_ts(rev),
                evidence_id=str(rev.get("evidence_id") or "") or None,
            )

    # 2. Market Overview KPIs + Leaders Table
    overview_env = by_tool.get("get_market_overview")
    if overview_env:
        odata = overview_env.get("data") if isinstance(overview_env.get("data"), dict) else {}
        oev = overview_env.get("evidence") if isinstance(overview_env.get("evidence"), dict) else {}
        quote = str(odata.get("quote_currency") or "USD")
        ts = _extract_primary_ts(oev)
        mode = str(oev.get("data_mode") or "") or None
        ev_id = str(oev.get("evidence_id") or "") or None

        if headline_chip is None and odata.get("fear_greed_classification"):
            headline_chip = AIHeadlineChip(
                label=str(odata["fear_greed_classification"]),
                sublabel=f"F&G {round(float(odata['fear_greed_value']))}"
                if _num(odata.get("fear_greed_value")) is not None
                else None,
                tone=_fg_tone(odata.get("fear_greed_value")),
                data_mode=mode,
                source_timestamp=ts,
                evidence_id=ev_id,
            )

        add_kpi(
            AIKpiMetric(
                label="Total Market Cap" if not is_id else "Kapitalisasi Pasar",
                value=fmt_compact(odata.get("total_market_cap"), quote),
                sub=f"24h: {fmt_pct(odata.get('total_market_cap_change_24h_pct'))}",
                tone=_pct_tone(odata.get("total_market_cap_change_24h_pct")),
                data_mode=mode,
                source_timestamp=ts,
                evidence_id=ev_id,
            )
        )
        btc = odata.get("btc") if isinstance(odata.get("btc"), dict) else None
        if btc:
            add_kpi(
                AIKpiMetric(
                    label="BTC Spot",
                    value=fmt_price(btc.get("price"), quote),
                    sub=f"Dom {fmt_pct(odata.get('btc_dominance'), signed=False)} · "
                    f"{fmt_pct(btc.get('percent_change_24h'))}",
                    tone=_pct_tone(btc.get("percent_change_24h")),
                    data_mode=mode,
                    source_timestamp=ts,
                    evidence_id=ev_id,
                )
            )
        add_kpi(
            AIKpiMetric(
                label="Fear & Greed",
                value=f"{round(float(odata['fear_greed_value']))} / 100"
                if _num(odata.get("fear_greed_value")) is not None
                else "—",
                sub=str(odata.get("fear_greed_classification") or ""),
                tone=_fg_tone(odata.get("fear_greed_value")),
                data_mode=mode,
                source_timestamp=ts,
                evidence_id=ev_id,
            )
        )
        add_kpi(
            AIKpiMetric(
                label="Top-50 Breadth" if not is_id else "Breadth Top-50",
                value=fmt_pct(odata.get("top50_breadth_positive_pct"), signed=False),
                sub=f"24h Vol {fmt_compact(odata.get('total_volume_24h'), quote)}",
                tone="positive"
                if (_num(odata.get("top50_breadth_positive_pct")) or 0) >= 50
                else "warning",
                data_mode=mode,
                source_timestamp=ts,
                evidence_id=ev_id,
            )
        )

        # Major coins table (when no specific comparison/screener/sector table is present)
        majors = [
            c
            for c in (odata.get("btc"), odata.get("eth"), odata.get("sol"))
            if isinstance(c, dict)
        ]
        if majors and not any(
            k in by_tool
            for k in (
                "compare_assets",
                "scan_market_movers",
                "analyze_sector_rotation",
                "list_hidden_gem_candidates",
            )
        ):
            tables.append(
                AIStructuredTable(
                    title="Major Spot Snapshot" if not is_id else "Ringkasan Aset Utama",
                    columns=[
                        "Aset" if is_id else "Asset",
                        "Harga" if is_id else "Price",
                        "24h",
                        "Market Cap",
                        "Vol 24h",
                    ],
                    rows=[
                        [
                            AITableCell(text=str(c.get("symbol") or "—")),
                            AITableCell(text=fmt_price(c.get("price"), quote)),
                            AITableCell(
                                text=fmt_pct(c.get("percent_change_24h")),
                                tone=_pct_tone(c.get("percent_change_24h")),
                            ),
                            AITableCell(text=fmt_compact(c.get("market_cap"), quote)),
                            AITableCell(text=fmt_compact(c.get("volume_24h"), quote)),
                        ]
                        for c in majors
                    ],
                )
            )

    # 3. Single Asset + Derivatives + Momentum (e.g. "Is SOL overextended?")
    asset_env = by_tool.get("analyze_asset")
    if asset_env:
        adata = asset_env.get("data") if isinstance(asset_env.get("data"), dict) else {}
        aev = asset_env.get("evidence") if isinstance(asset_env.get("evidence"), dict) else {}
        sym = str(adata.get("symbol") or "ASSET")
        quote = str(adata.get("quote_currency") or "USD")
        ts = _extract_primary_ts(aev)
        mode = str(aev.get("data_mode") or "") or None
        ev_id = str(aev.get("evidence_id") or "") or None

        add_kpi(
            AIKpiMetric(
                label=f"{sym} " + ("Harga" if is_id else "Price"),
                value=fmt_price(adata.get("price"), quote),
                sub=f"24h: {fmt_pct(adata.get('percent_change_24h'))}",
                tone=_pct_tone(adata.get("percent_change_24h")),
                data_mode=mode,
                source_timestamp=ts,
                evidence_id=ev_id,
            )
        )
        add_kpi(
            AIKpiMetric(
                label="7d / 30d",
                value=fmt_pct(adata.get("percent_change_7d")),
                sub=f"30d: {fmt_pct(adata.get('percent_change_30d'))}",
                tone=_pct_tone(adata.get("percent_change_7d")),
                data_mode=mode,
                source_timestamp=ts,
                evidence_id=ev_id,
            )
        )
        add_kpi(
            AIKpiMetric(
                label="RS vs BTC (7d)",
                value=fmt_pct(adata.get("rs_vs_btc_7d")),
                sub=f"30d: {fmt_pct(adata.get('rs_vs_btc_30d'))}",
                tone=_pct_tone(adata.get("rs_vs_btc_7d")),
                data_mode=mode,
                source_timestamp=ts,
                evidence_id=ev_id,
            )
        )
        add_kpi(
            AIKpiMetric(
                label="Momentum Score" if not is_id else "Skor Momentum",
                value=fmt_score(adata.get("composite_momentum_score")),
                sub=f"Vol/MCap {fmt_ratio(adata.get('volume_to_mcap'))}",
                tone="info"
                if (_num(adata.get("composite_momentum_score")) or 0) >= 60
                else "neutral",
                data_mode=mode,
                source_timestamp=ts,
                evidence_id=ev_id,
            )
        )
        if sparkline is None:
            sparkline = _build_asset_sparkline(sym, adata, is_id=is_id)

        # Put FDV, supply & missing OHLCV fields cleanly into collapsible accordion
        details.append(
            AIDetailItem(
                label="Market Cap & Volume 24h",
                value=f"{fmt_compact(adata.get('market_cap'), quote)} · "
                f"Vol {fmt_compact(adata.get('volume_24h'), quote)}",
                note=f"FDV/MCap: {fmt_ratio(adata.get('fdv_to_mcap_ratio'))} · "
                f"Circulating: {fmt_pct(adata.get('circulating_supply_pct'), signed=False)}",
            )
        )
        if _num(adata.get("annualized_volatility")) is None:
            details.append(
                AIDetailItem(
                    label="Volatilitas & Drawdown 365d" if is_id else "365d Volatility & Drawdown",
                    value="TIER_RESTRICTED",
                    note=(
                        "Tidak tersedia di paket CoinMarketCap saat ini (gunakan BYOK untuk OHLCV)."
                        if is_id
                        else "Unavailable on active CoinMarketCap plan (supports BYOK for OHLCV)."
                    ),
                )
            )

    # Derivatives details cleanly organized
    deriv_env = by_tool.get("analyze_derivatives")
    if deriv_env:
        ddata = deriv_env.get("data") if isinstance(deriv_env.get("data"), dict) else {}
        quote = str(ddata.get("quote_currency") or "USD")
        fr = _num(ddata.get("funding_rate"))
        oi = _num(ddata.get("open_interest"))
        details.append(
            AIDetailItem(
                label=f"{ddata.get('symbol', 'Asset')} Derivatives",
                value=(
                    f"OI {fmt_compact(oi, quote)}" if oi is not None else "Funding / OI Partial"
                ),
                note=(
                    f"Funding: {fmt_pct(fr * 100) if fr is not None else 'Unavailable'} · "
                    f"Mode: {ddata.get('mode') or '—'} · "
                    + (
                        "Likuidasi per koin tidak tersedia di feed CMC."
                        if is_id
                        else "Coin-specific liquidations not exposed on active CMC feed."
                    )
                ),
            )
        )

    # 4. Compare Assets / Momentum / Movers / Sectors / Hidden Gems / Anomalies Tables
    compare_env = by_tool.get("compare_assets")
    if compare_env:
        cdata = compare_env.get("data") if isinstance(compare_env.get("data"), dict) else {}
        quote = str(cdata.get("quote_currency") or "USD")
        assets = cdata.get("assets") or []
        if assets and len(tables) < 2:
            tables.append(
                AIStructuredTable(
                    title="Asset Comparison" if not is_id else "Perbandingan Aset",
                    columns=[
                        "Aset" if is_id else "Asset",
                        "Harga" if is_id else "Price",
                        "24h",
                        "7d",
                        "30d",
                        "RS vs BTC",
                        "Skor" if is_id else "Score",
                    ],
                    rows=[
                        [
                            AITableCell(text=str(a.get("symbol") or "—")),
                            AITableCell(text=fmt_price(a.get("price"), quote)),
                            AITableCell(
                                text=fmt_pct(a.get("percent_change_24h")),
                                tone=_pct_tone(a.get("percent_change_24h")),
                            ),
                            AITableCell(
                                text=fmt_pct(a.get("percent_change_7d")),
                                tone=_pct_tone(a.get("percent_change_7d")),
                            ),
                            AITableCell(
                                text=fmt_pct(a.get("percent_change_30d")),
                                tone=_pct_tone(a.get("percent_change_30d")),
                            ),
                            AITableCell(
                                text=fmt_pct(a.get("rs_vs_btc_7d")),
                                tone=_pct_tone(a.get("rs_vs_btc_7d")),
                            ),
                            AITableCell(text=fmt_score(a.get("composite_momentum_score"))),
                        ]
                        for a in assets[:8]
                        if isinstance(a, dict)
                    ],
                )
            )
            if sparkline is None and isinstance(assets[0], dict):
                sparkline = _build_asset_sparkline(
                    str(assets[0].get("symbol") or "Asset"), assets[0], is_id=is_id
                )

    movers_env = by_tool.get("scan_market_movers")
    if movers_env:
        mdata = movers_env.get("data") if isinstance(movers_env.get("data"), dict) else {}
        quote = str(mdata.get("quote_currency") or "USD")
        movers = mdata.get("movers") or []
        if movers and len(tables) < 2:
            tables.append(
                AIStructuredTable(
                    title="Anti-Chase Screened Movers" if not is_id else "Movers Anti-FOMO",
                    columns=[
                        "Aset" if is_id else "Asset",
                        "MCap",
                        "24h",
                        "7d",
                        "RS vs BTC",
                        "Skor" if is_id else "Score",
                    ],
                    rows=[
                        [
                            AITableCell(text=str(m.get("symbol") or "—")),
                            AITableCell(text=fmt_compact(m.get("market_cap"), quote)),
                            AITableCell(
                                text=fmt_pct(m.get("percent_change_24h")),
                                tone=_pct_tone(m.get("percent_change_24h")),
                            ),
                            AITableCell(
                                text=fmt_pct(m.get("percent_change_7d")),
                                tone=_pct_tone(m.get("percent_change_7d")),
                            ),
                            AITableCell(
                                text=fmt_pct(m.get("rs_vs_btc_7d")),
                                tone=_pct_tone(m.get("rs_vs_btc_7d")),
                            ),
                            AITableCell(text=fmt_score(m.get("composite_momentum_score"))),
                        ]
                        for m in movers[:8]
                        if isinstance(m, dict)
                    ],
                )
            )

    sector_env = by_tool.get("analyze_sector_rotation")
    if sector_env:
        sdata = sector_env.get("data") if isinstance(sector_env.get("data"), dict) else {}
        sectors = sdata.get("sectors") or []
        if sectors and len(tables) < 2:
            tables.append(
                AIStructuredTable(
                    title="7-Sector Rotation" if not is_id else "Rotasi 7 Sektor",
                    columns=[
                        "Sektor" if is_id else "Sector",
                        "Aset" if is_id else "Assets",
                        "Med 24h",
                        "Med 7d",
                        "Vol Share",
                        "Sinyal" if is_id else "Signal",
                    ],
                    rows=[
                        [
                            AITableCell(text=str(s.get("display_name") or s.get("sector_slug"))),
                            AITableCell(text=str(s.get("constituent_count") or "—")),
                            AITableCell(
                                text=fmt_pct(s.get("median_change_24h_pct")),
                                tone=_pct_tone(s.get("median_change_24h_pct")),
                            ),
                            AITableCell(
                                text=fmt_pct(s.get("median_change_7d_pct")),
                                tone=_pct_tone(s.get("median_change_7d_pct")),
                            ),
                            AITableCell(
                                text=fmt_pct(s.get("sector_volume_share_pct"), signed=False)
                            ),
                            AITableCell(
                                text=str(s.get("rotation_signal") or "—"),
                                tone="positive"
                                if str(s.get("rotation_signal")) in {"LEADING", "GAINING_MOMENTUM"}
                                else "destructive"
                                if str(s.get("rotation_signal")) == "WEAKENING"
                                else "warning",
                            ),
                        ]
                        for s in sectors[:8]
                        if isinstance(s, dict)
                    ],
                )
            )

    gems_env = by_tool.get("list_hidden_gem_candidates")
    if gems_env:
        gdata = gems_env.get("data") if isinstance(gems_env.get("data"), dict) else {}
        candidates = gdata.get("candidates") or gdata.get("items") or []
        if candidates and len(tables) < 2:
            tables.append(
                AIStructuredTable(
                    title="Hidden Gem Candidates" if not is_id else "Kandidat Hidden Gem",
                    columns=[
                        "Aset" if is_id else "Asset",
                        "Track",
                        "Skor" if is_id else "Score",
                        "Conf",
                        "24h",
                        "7d",
                    ],
                    rows=[
                        [
                            AITableCell(text=str(c.get("symbol") or "—")),
                            AITableCell(text=str(c.get("discovery_track") or "—")),
                            AITableCell(text=fmt_score(c.get("final_score")), tone="positive"),
                            AITableCell(text=str(c.get("confidence") or "—")),
                            AITableCell(
                                text=fmt_pct(c.get("percent_change_24h")),
                                tone=_pct_tone(c.get("percent_change_24h")),
                            ),
                            AITableCell(
                                text=fmt_pct(c.get("percent_change_7d")),
                                tone=_pct_tone(c.get("percent_change_7d")),
                            ),
                        ]
                        for c in candidates[:8]
                        if isinstance(c, dict)
                    ],
                )
            )

    anom_env = by_tool.get("detect_market_anomalies")
    if anom_env:
        andata = anom_env.get("data") if isinstance(anom_env.get("data"), dict) else {}
        anoms = andata.get("anomalies") or []
        if anoms and len(tables) < 2:
            tables.append(
                AIStructuredTable(
                    title="Detected Anomalies" if not is_id else "Anomali Terdeteksi",
                    columns=[
                        "Aset" if is_id else "Asset",
                        "24h",
                        "Vol/MCap",
                        "Mod Z",
                        "Tipe" if is_id else "Type",
                    ],
                    rows=[
                        [
                            AITableCell(text=str(a.get("symbol") or "—")),
                            AITableCell(
                                text=fmt_pct(a.get("percent_change_24h")),
                                tone=_pct_tone(a.get("percent_change_24h")),
                            ),
                            AITableCell(text=fmt_ratio(a.get("volume_to_mcap"))),
                            AITableCell(text=fmt_ratio(a.get("modified_z_score"))),
                            AITableCell(text=str(a.get("anomaly_type") or "—")),
                        ]
                        for a in anoms[:8]
                        if isinstance(a, dict)
                    ],
                )
            )

    # 5. Momentum standalone (only if analyze_asset didn't already fill KPIs/table)
    mom_env = by_tool.get("analyze_momentum")
    if mom_env and not kpis:
        mdata = mom_env.get("data") if isinstance(mom_env.get("data"), dict) else {}
        mev = mom_env.get("evidence") if isinstance(mom_env.get("evidence"), dict) else {}
        rows = mdata.get("assets") or []
        if rows and isinstance(rows[0], dict):
            first = rows[0]
            sym = str(first.get("symbol") or "Asset")
            ts = _extract_primary_ts(mev)
            mode = str(mev.get("data_mode") or "") or None
            ev_id = str(mev.get("evidence_id") or "") or None
            add_kpi(
                AIKpiMetric(
                    label=f"{sym} Momentum",
                    value=fmt_score(first.get("composite_momentum_score")),
                    sub=f"24h {fmt_pct(first.get('percent_change_24h'))}",
                    tone=_pct_tone(first.get("percent_change_24h")),
                    data_mode=mode,
                    source_timestamp=ts,
                    evidence_id=ev_id,
                )
            )
            add_kpi(
                AIKpiMetric(
                    label="7d / 30d",
                    value=fmt_pct(first.get("percent_change_7d")),
                    sub=f"30d {fmt_pct(first.get('percent_change_30d'))}",
                    tone=_pct_tone(first.get("percent_change_7d")),
                    data_mode=mode,
                    source_timestamp=ts,
                    evidence_id=ev_id,
                )
            )
            add_kpi(
                AIKpiMetric(
                    label="RS vs BTC 7d",
                    value=fmt_pct(first.get("rs_vs_btc_7d")),
                    sub=f"30d {fmt_pct(first.get('rs_vs_btc_30d'))}",
                    tone=_pct_tone(first.get("rs_vs_btc_7d")),
                    data_mode=mode,
                    source_timestamp=ts,
                    evidence_id=ev_id,
                )
            )
            if sparkline is None:
                sparkline = _build_asset_sparkline(sym, first, is_id=is_id)

    # 6. Historical performance fallback KPI/details
    hist_env = by_tool.get("get_historical_performance")
    if hist_env:
        hdata = hist_env.get("data") if isinstance(hist_env.get("data"), dict) else {}
        if hist_env.get("status") == "TIER_RESTRICTED":
            details.append(
                AIDetailItem(
                    label=f"{hdata.get('symbol', 'Asset')} Historical OHLCV",
                    value="TIER_RESTRICTED",
                    note=(
                        "Data historis harian memerlukan paket CoinMarketCap lebih tinggi (BYOK)."
                        if is_id
                        else "Daily OHLCV requires a higher CoinMarketCap plan (supports BYOK)."
                    ),
                )
            )

    lim_parts: list[str] = []
    if evidence_tags:
        lim_parts.append("Evidence: " + ", ".join(evidence_tags))
    if limitation_notes:
        lim_parts.append(" | ".join(limitation_notes[:2]))

    if not any([headline_chip, kpis, tables, sparkline, details, lim_parts]):
        return None

    return AIStructuredSummary(
        headline_chip=headline_chip,
        kpis=kpis,
        tables=tables,
        sparkline=sparkline,
        details=details,
        limitations_line=" · ".join(lim_parts) if lim_parts else None,
    )
