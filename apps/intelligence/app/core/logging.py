import json
import logging
import re
import sys
from datetime import UTC, datetime

_REDACTED = "[redacted]"
_secrets: set[str] = set()
_KEY_PATTERNS = (
    re.compile(r"\b(?:ct_live|tg_live|tg_sandbox)_[A-Za-z0-9_-]{6,}\b"),
    re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,\"';&]+"),
    re.compile(r"(?i)(\bbearer\s+)[A-Za-z0-9._~+/-]{12,}=*"),
    re.compile(r"(?i)(x-cointrac-key\s*[:=]\s*)[^\s,\"';&]+"),
    re.compile(r"(?i)(x-tradeguard-key\s*[:=]\s*)[^\s,\"';&]+"),
    re.compile(r"(?i)(x-cmc-api-key\s*[:=]\s*)[^\s,\"';&]+"),
    re.compile(r"(?i)([?&](?:api_key|key|token|access_token|x-cointrac-key|x-tradeguard-key)=)[^&\s\"']+"),
)


def register_secrets(*values: str) -> None:
    for value in values:
        cleaned = value.strip()
        if len(cleaned) >= 8 and not cleaned.startswith("your_"):
            _secrets.add(cleaned)


def redact(message: str) -> str:
    cleaned = message
    for secret in _secrets:
        cleaned = cleaned.replace(secret, _REDACTED)
    cleaned = _KEY_PATTERNS[0].sub(_REDACTED, cleaned)
    for pattern in _KEY_PATTERNS[1:]:
        cleaned = pattern.sub(rf"\1{_REDACTED}", cleaned)
    return cleaned


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        return json.dumps(payload, ensure_ascii=True)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    for logger_name in ("cointrac",):
        logger = logging.getLogger(logger_name)
        logger.handlers = [handler]
        logger.setLevel(logging.INFO)
        logger.propagate = False
    # The HTTP client logs full request URLs, which include key hashes.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
