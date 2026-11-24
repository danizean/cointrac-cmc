import json
import os
import urllib.request

BASE = os.environ.get("COINTRAC_API_URL", "http://localhost:8000").rstrip("/")
API_KEY = os.environ["COINTRAC_API_KEY"]


def post(path: str, payload: dict[str, object]) -> dict[str, object]:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        body = json.load(response)
    if not isinstance(body, dict):
        raise RuntimeError("CoinTrac returned a non-object response")
    return body


def main() -> None:
    envelope = post(
        "/v1/intelligence/compare-assets",
        {"symbols": ["SOL", "AVAX", "NEAR"]},
    )
    print(envelope["tool"], envelope["evidence"]["evidence_id"])


if __name__ == "__main__":
    main()
