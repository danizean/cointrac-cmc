"""Probe CoinMarketCap Pro endpoints and write a capability matrix.

Reads CMC_API_KEY from the repository .env. The key is never printed or written.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DOCS_DIR = ROOT / "docs"
MATRIX_PATH = DOCS_DIR / "CMC_CAPABILITY_MATRIX.json"
FEEDBACK_PATH = DOCS_DIR / "CMC_API_FEEDBACK.md"
CREDIT_BUDGET = 30
PAUSE_SECONDS = 0.5
TIME_SERIES = {
    "/v1/global-metrics/quotes/historical",
    "/v3/fear-and-greed/historical",
    "/v2/cryptocurrency/ohlcv/historical",
}

CORE_PROBES: list[dict[str, Any]] = [
    {"endpoint": "/v1/cryptocurrency/map", "params": {"limit": 5}},
    {"endpoint": "/v2/cryptocurrency/info", "params": {"id": "1,1027"}},
    {"endpoint": "/v2/cryptocurrency/quotes/latest", "params": {"id": "1,1027,5426"}},
    {"endpoint": "/v1/cryptocurrency/listings/latest", "params": {"limit": 10}},
    {"endpoint": "/v1/global-metrics/quotes/latest", "params": {}},
    {
        "endpoint": "/v1/global-metrics/quotes/historical",
        "params": {"count": 7, "interval": "daily"},
    },
    {"endpoint": "/v3/fear-and-greed/latest", "params": {}},
    {"endpoint": "/v3/fear-and-greed/historical", "params": {"limit": 7}},
    {"endpoint": "/v1/cryptocurrency/categories", "params": {"limit": 10}},
    {"endpoint": "/v2/cryptocurrency/ohlcv/historical", "params": {"id": 1, "count": 30, "interval": "daily"}},
    {"endpoint": "/v2/cryptocurrency/price-performance-stats/latest", "params": {"id": 1}},
    {"endpoint": "/v1/cryptocurrency/trending/latest", "params": {"limit": 5}},
    {"endpoint": "/v2/cryptocurrency/market-pairs/latest", "params": {"id": 1, "limit": 5}},
]

CANDIDATE_PROBES: list[dict[str, Any]] = [
    {"endpoint": "/v5/real-world-assets/map", "params": {"limit": 5}},
    {"endpoint": "/v5/real-world-assets/assets/list", "params": {"limit": 5}},
    {"endpoint": "/v5/exchange/derivatives/list", "params": {"limit": 5}},
    {
        "endpoint": "/v5/cryptocurrency/derivatives/market-pairs/list/latest",
        "params": {"crypto_id": 1, "limit": 5},
    },
    {"endpoint": "/v5/derivatives/liquidations/quotes/latest", "params": {}},
    {"endpoint": "/v4/dex/spot-pairs/latest", "params": {"limit": 5}},
]


def load_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def classify(http_status: int, error_code: int | None) -> str:
    if http_status == 404:
        return "NOT_FOUND"
    if http_status in {402, 403} or error_code == 1006:
        return "TIER_RESTRICTED"
    if http_status == 200 and error_code in {None, 0}:
        return "AVAILABLE"
    return "ERROR"


def sample_top_keys(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data", payload)
    if isinstance(data, dict):
        return [str(key) for key in list(data.keys())[:12]]
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return [str(key) for key in list(data[0].keys())[:12]]
    return [str(key) for key in list(payload.keys())[:12]]


def historical_count(endpoint: str, payload: Any) -> int | None:
    if endpoint not in TIME_SERIES or not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        quotes = data.get("quotes")
        if isinstance(quotes, list):
            return len(quotes)
        for value in data.values():
            if isinstance(value, dict) and isinstance(value.get("quotes"), list):
                return len(value["quotes"])
            if isinstance(value, list):
                return len(value)
    return 0


def first_category_id(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    rows: list[Any]
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = list(data.values())
    else:
        return None
    for row in rows:
        if isinstance(row, dict) and row.get("id") not in {None, ""}:
            return str(row["id"])
    return None


def schema_notes(endpoint: str, payload: Any, status: str) -> list[str]:
    if status != "AVAILABLE" or not isinstance(payload, dict):
        return []
    notes: list[str] = []
    if "data" not in payload:
        notes.append(f"{endpoint} returned no data field")
    if "status" not in payload:
        notes.append(f"{endpoint} returned no status field")
    if endpoint in TIME_SERIES and historical_count(endpoint, payload) == 0:
        notes.append(f"{endpoint} returned an empty time series")
    return notes


def redact(text: str, secret: str) -> str:
    if secret and secret in text:
        return text.replace(secret, "[redacted]")
    return text


def probe_one(
    client: httpx.Client,
    endpoint: str,
    params: dict[str, Any],
    secret: str,
) -> tuple[dict[str, Any], Any]:
    try:
        response = client.get(endpoint, params=params)
    except httpx.HTTPError as exc:
        message = redact(str(exc), secret)
        return (
            {
                "endpoint": endpoint,
                "params": params,
                "http_status": 0,
                "cmc_error_code": None,
                "cmc_error_message": message,
                "credit_count": 0,
                "status": "ERROR",
                "sample_top_keys": [],
                "historical_count_returned": historical_count(endpoint, {}),
            },
            None,
        )

    payload: Any = None
    try:
        payload = response.json()
    except json.JSONDecodeError:
        payload = None

    status_block = payload.get("status", {}) if isinstance(payload, dict) else {}
    error_code = status_block.get("error_code")
    error_code = int(error_code) if isinstance(error_code, int) else None
    error_message = status_block.get("error_message")
    if not isinstance(error_message, str):
        error_message = None
    credit_count = status_block.get("credit_count")
    credit_count = int(credit_count) if isinstance(credit_count, int) else 0
    if error_message:
        error_message = redact(error_message, secret)

    result = {
        "endpoint": endpoint,
        "params": params,
        "http_status": response.status_code,
        "cmc_error_code": error_code,
        "cmc_error_message": error_message,
        "credit_count": credit_count,
        "status": classify(response.status_code, error_code),
        "sample_top_keys": sample_top_keys(payload),
        "historical_count_returned": historical_count(endpoint, payload),
    }
    return result, payload


def write_feedback(notes: list[str], generated_at: str) -> None:
    lines = [
        "# CMC API Feedback",
        "",
        "Initial draft generated by `scripts/probe_cmc.py`.",
        "Regenerated on each probe so this section matches the latest matrix.",
        "",
        "## Observed API Gaps & Friction",
        "",
        f"Probed at {generated_at}.",
        "",
    ]
    if notes:
        lines.extend(f"- {note}" for note in notes)
    else:
        lines.append("- No tier restrictions, schema mismatches, or missing fields were observed in this run.")
    lines.append("")
    FEEDBACK_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    env = load_env(ENV_PATH)
    api_key = env.get("CMC_API_KEY", "").strip()
    base_url = env.get("CMC_BASE_URL", "https://pro-api.coinmarketcap.com").rstrip("/")
    if not api_key or api_key.startswith("your_"):
        print("CMC_API_KEY is missing. Add it to .env, then run this script again.", file=sys.stderr)
        return 1

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    friction: list[str] = []
    total_credits = 0
    category_payload: Any = None
    unauthorized = False

    probes = list(CORE_PROBES)
    with httpx.Client(
        base_url=base_url,
        headers={"X-CMC_PRO_API_KEY": api_key, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=False,
    ) as client:
        index = 0
        while index < len(probes):
            if total_credits >= CREDIT_BUDGET:
                for skipped in probes[index:]:
                    results.append(
                        {
                            "endpoint": skipped["endpoint"],
                            "params": skipped["params"],
                            "http_status": 0,
                            "cmc_error_code": None,
                            "cmc_error_message": "Skipped to stay under the 30 credit budget.",
                            "credit_count": 0,
                            "status": "ERROR",
                            "sample_top_keys": [],
                            "historical_count_returned": None,
                        }
                    )
                    friction.append(f"{skipped['endpoint']} was not called because the credit budget was reached.")
                break

            probe = probes[index]
            if index > 0:
                time.sleep(PAUSE_SECONDS)
            result, payload = probe_one(client, probe["endpoint"], probe["params"], api_key)
            results.append(result)
            total_credits += int(result["credit_count"])
            print(f"{result['status']:16} {result['http_status']:3} credits={result['credit_count']} {result['endpoint']}")

            if result["status"] == "TIER_RESTRICTED":
                friction.append(
                    f"{result['endpoint']} is TIER_RESTRICTED "
                    f"(HTTP {result['http_status']}, CMC {result['cmc_error_code']}: {result['cmc_error_message']})."
                )
            friction.extend(schema_notes(result["endpoint"], payload, result["status"]))
            if result["cmc_error_code"] == 1002 or result["http_status"] == 401:
                unauthorized = True
                friction.append("The API key was rejected. Remaining endpoints were not called.")
                break

            if probe["endpoint"] == "/v1/cryptocurrency/categories" and result["status"] == "AVAILABLE":
                category_payload = payload
            index += 1

            if probe["endpoint"] == "/v1/cryptocurrency/categories":
                category_id = first_category_id(category_payload)
                if category_id:
                    probes.insert(
                        index,
                        {
                            "endpoint": "/v1/cryptocurrency/category",
                            "params": {"id": category_id, "limit": 5},
                        },
                    )
                else:
                    friction.append(
                        "/v1/cryptocurrency/category was not called because categories returned no usable id."
                    )

        if not unauthorized and total_credits < CREDIT_BUDGET:
            for candidate in CANDIDATE_PROBES:
                if total_credits >= CREDIT_BUDGET:
                    friction.append(f"{candidate['endpoint']} was not called because the credit budget was reached.")
                    continue
                time.sleep(PAUSE_SECONDS)
                result, payload = probe_one(client, candidate["endpoint"], candidate["params"], api_key)
                results.append(result)
                total_credits += int(result["credit_count"])
                print(
                    f"{result['status']:16} {result['http_status']:3} credits={result['credit_count']} {result['endpoint']}"
                )
                if result["status"] == "TIER_RESTRICTED":
                    friction.append(
                        f"{result['endpoint']} is TIER_RESTRICTED "
                        f"(HTTP {result['http_status']}, CMC {result['cmc_error_code']}: {result['cmc_error_message']})."
                    )
                if result["status"] == "NOT_FOUND":
                    friction.append(f"{result['endpoint']} returned NOT_FOUND.")
                friction.extend(schema_notes(result["endpoint"], payload, result["status"]))

    generated_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    matrix = {
        "generated_at_utc": generated_at,
        "base_url": base_url,
        "credit_budget": CREDIT_BUDGET,
        "total_credits_used": total_credits,
        "results": results,
    }
    MATRIX_PATH.write_text(json.dumps(matrix, indent=2) + "\n", encoding="utf-8")
    write_feedback(friction, generated_at)
    print(f"Probed: {len(results)} Total credits: {total_credits}")
    if unauthorized:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
