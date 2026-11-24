from dataclasses import dataclass, field

MIN_BREADTH_SAMPLE = 10


@dataclass(frozen=True)
class RegimeAssessment:
    regime: str | None
    rationale: list[str]
    signal_conflict: bool = False
    confidence: str | None = None
    dominant_signals: list[str] = field(default_factory=list)
    conflicting_signals: list[str] = field(default_factory=list)


def classify_regime(
    *,
    total_mcap_change_24h_pct: float | None,
    btc_dominance_change_24h: float | None,
    top50_breadth_positive_pct: float | None,
    fear_greed_value: float | None,
    btc_outperforming_median_alt: bool | None,
    breadth_sample_size: int | None = None,
    stale_inputs: bool = False,
) -> RegimeAssessment:
    present = [
        total_mcap_change_24h_pct,
        btc_dominance_change_24h,
        top50_breadth_positive_pct,
        fear_greed_value,
        btc_outperforming_median_alt,
    ]
    available_count = sum(1 for value in present if value is not None)
    if available_count == 0:
        return RegimeAssessment(
            None,
            ["No regime inputs were available."],
            confidence=None,
        )

    low_breadth_sample = (
        breadth_sample_size is not None and breadth_sample_size < MIN_BREADTH_SAMPLE
    )
    effective_breadth = None if breadth_sample_size == 0 else top50_breadth_positive_pct

    structural_stress = _structural_stress_reasons(
        total_mcap_change_24h_pct,
        effective_breadth,
    )
    sentiment_stress = fear_greed_value is not None and fear_greed_value <= 30
    strong_bullish_structure = (
        total_mcap_change_24h_pct is not None
        and total_mcap_change_24h_pct > 0
        and effective_breadth is not None
        and effective_breadth >= 60
    )

    dominant: list[str] = []
    conflicts: list[str] = []
    notes: list[str] = []

    if low_breadth_sample:
        notes.append(
            f"Breadth sample size ({breadth_sample_size}) is below minimum "
            f"{MIN_BREADTH_SAMPLE}; classification confidence reduced."
        )
    if stale_inputs:
        notes.append(
            "One or more regime inputs are aging/stale; classification confidence reduced."
        )

    # 1. Structural stress (mcap <= -2% or breadth <= 30%) cannot be erased by positive sentiment
    if structural_stress:
        dominant.extend(structural_stress)
        if sentiment_stress:
            dominant.append(f"Fear & Greed is at {fear_greed_value:.0f} (<= 30).")
        elif fear_greed_value is not None and fear_greed_value >= 65:
            conflicts.append(
                f"Fear & Greed ({fear_greed_value:.0f}) remains elevated despite structural stress."
            )
        if effective_breadth is not None and effective_breadth >= 60:
            conflicts.append(
                f"Top-50 breadth ({effective_breadth:.1f}%) is positive despite "
                "market-cap drawdown."
            )
        has_conflict = bool(conflicts)
        confidence = _confidence(
            available_count=available_count,
            has_conflict=has_conflict,
            stale_inputs=stale_inputs,
            low_breadth_sample=low_breadth_sample,
            strong_agreement=(len(dominant) >= 2),
        )
        rationale = [*dominant, *conflicts, *notes]
        return RegimeAssessment(
            "RISK_OFF_STRESS",
            rationale,
            signal_conflict=has_conflict,
            confidence=confidence,
            dominant_signals=dominant,
            conflicting_signals=conflicts,
        )

    # 2. Sentiment-only stress (F&G <= 30) conflicts with strong positive market structure
    if sentiment_stress:
        if strong_bullish_structure:
            dominant.append(
                f"Total market cap is +{total_mcap_change_24h_pct:.2f}% (24h) with "
                f"{effective_breadth:.1f}% Top-50 positive breadth."
            )
            if btc_dominance_change_24h is not None and btc_dominance_change_24h > 0:
                dominant.append(
                    f"BTC dominance rose +{btc_dominance_change_24h:.2f}pp"
                    + (
                        " with BTC outperforming the median alt."
                        if btc_outperforming_median_alt
                        else "."
                    )
                )
            conflicts.append(
                f"Fear & Greed at {fear_greed_value:.0f} (<= 30) strongly conflicts with "
                "broad positive market structure; single lagging sentiment reading cannot "
                "force RISK_OFF_STRESS."
            )
            rationale = [
                "Market structure and sentiment are in explicit conflict "
                "(relief rally / lagging fear); classified as RANGE_CONSOLIDATION "
                "with LOW confidence.",
                *dominant,
                *conflicts,
                *notes,
            ]
            return RegimeAssessment(
                "RANGE_CONSOLIDATION",
                rationale,
                signal_conflict=True,
                confidence="LOW",
                dominant_signals=dominant,
                conflicting_signals=conflicts,
            )
        dominant.append(
            f"Fear & Greed is at {fear_greed_value:.0f} (<= 30) without offsetting rally."
        )
        confidence = _confidence(
            available_count=available_count,
            has_conflict=False,
            stale_inputs=stale_inputs,
            low_breadth_sample=low_breadth_sample,
            strong_agreement=False,
        )
        return RegimeAssessment(
            "RISK_OFF_STRESS",
            [*dominant, *notes],
            signal_conflict=False,
            confidence=confidence,
            dominant_signals=dominant,
            conflicting_signals=[],
        )

    # 3. Risk-on altseason
    if _risk_on(
        total_mcap_change_24h_pct,
        btc_dominance_change_24h,
        effective_breadth,
        fear_greed_value,
    ):
        dominant.append(
            "Market cap is rising, BTC dominance is falling, breadth is at least 60%, "
            "and Fear & Greed is at least 55."
        )
        confidence = _confidence(
            available_count=available_count,
            has_conflict=False,
            stale_inputs=stale_inputs,
            low_breadth_sample=low_breadth_sample,
            strong_agreement=True,
        )
        return RegimeAssessment(
            "RISK_ON_ALTSEASON",
            [*dominant, *notes],
            signal_conflict=False,
            confidence=confidence,
            dominant_signals=dominant,
            conflicting_signals=[],
        )

    # 4. BTC-led expansion
    if _btc_led(
        total_mcap_change_24h_pct,
        btc_dominance_change_24h,
        btc_outperforming_median_alt,
    ):
        dominant.append(
            "Market cap is rising, BTC dominance is rising, and BTC is ahead of the median alt."
        )
        confidence = _confidence(
            available_count=available_count,
            has_conflict=False,
            stale_inputs=stale_inputs,
            low_breadth_sample=low_breadth_sample,
            strong_agreement=(effective_breadth is not None and effective_breadth >= 40),
        )
        return RegimeAssessment(
            "BTC_LED_EXPANSION",
            [*dominant, *notes],
            signal_conflict=False,
            confidence=confidence,
            dominant_signals=dominant,
            conflicting_signals=[],
        )

    # 5. Range / mixed consolidation
    has_conflict = (
        total_mcap_change_24h_pct is not None
        and effective_breadth is not None
        and ((total_mcap_change_24h_pct > 1 and effective_breadth < 45)
             or (total_mcap_change_24h_pct < -1 and effective_breadth > 55))
    )
    if has_conflict:
        conflicts.append(
            f"Market cap change ({total_mcap_change_24h_pct:+.2f}%) diverges from "
            f"Top-50 breadth ({effective_breadth:.1f}%)."
        )
    dominant.append("Signals are mixed, so no directional regime rule matched.")
    confidence = _confidence(
        available_count=available_count,
        has_conflict=has_conflict,
        stale_inputs=stale_inputs,
        low_breadth_sample=low_breadth_sample,
        strong_agreement=False,
    )
    return RegimeAssessment(
        "RANGE_CONSOLIDATION",
        [*dominant, *conflicts, *notes],
        signal_conflict=has_conflict,
        confidence=confidence,
        dominant_signals=dominant,
        conflicting_signals=conflicts,
    )


def _structural_stress_reasons(
    market_cap_change: float | None,
    breadth: float | None,
) -> list[str]:
    reasons: list[str] = []
    if market_cap_change is not None and market_cap_change <= -2:
        reasons.append("Total market-cap change is at or below -2%.")
    if breadth is not None and breadth <= 30:
        reasons.append("Top-50 breadth is at or below 30%.")
    return reasons


def _confidence(
    *,
    available_count: int,
    has_conflict: bool,
    stale_inputs: bool,
    low_breadth_sample: bool,
    strong_agreement: bool,
) -> str:
    if has_conflict or stale_inputs or low_breadth_sample or available_count < 3:
        return "LOW"
    if strong_agreement and available_count >= 4:
        return "HIGH"
    return "MEDIUM"


def _risk_on(
    market_cap_change: float | None,
    dominance_change: float | None,
    breadth: float | None,
    fear_greed: float | None,
) -> bool:
    return (
        market_cap_change is not None
        and market_cap_change > 0
        and dominance_change is not None
        and dominance_change < 0
        and breadth is not None
        and breadth >= 60
        and fear_greed is not None
        and fear_greed >= 55
    )


def _btc_led(
    market_cap_change: float | None,
    dominance_change: float | None,
    btc_outperforming: bool | None,
) -> bool:
    return (
        market_cap_change is not None
        and market_cap_change > 0
        and dominance_change is not None
        and dominance_change > 0
        and btc_outperforming is True
    )
