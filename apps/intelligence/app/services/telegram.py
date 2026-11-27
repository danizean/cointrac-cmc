"""Optional Telegram alert formatter and async dispatcher for Hidden Gem alerts."""

from __future__ import annotations

import html
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

logger = logging.getLogger("cointrac.telegram")

SendHook = Callable[[str, str], Awaitable[bool]]


@dataclass(frozen=True)
class TelegramDispatchResult:
    attempted: bool
    sent: bool
    error: str | None = None


def _fmt_usd(value: object) -> str | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    num = float(value)
    if num >= 1_000_000_000:
        return f"${num / 1_000_000_000:.2f}B"
    if num >= 1_000_000:
        return f"${num / 1_000_000:.2f}M"
    if num >= 1_000:
        return f"${num / 1_000:.1f}K"
    if num >= 1.0:
        return f"${num:,.2f}"
    return f"${num:.6g}"


def format_hidden_gem_alert_html(alert: dict[str, object]) -> str:
    """Format an hg_alert_events row as HTML-escaped Telegram message text."""
    event_type = str(alert.get("event_type") or "NEW_DISCOVERY")
    event_labels = {
        "NEW_DISCOVERY": "New Discovery",
        "CONFIRMATION": "Confidence Upgraded",
        "SCORE_UPGRADE": "Score Upgrade",
        "INVALIDATION": "Invalidated",
    }
    label = html.escape(event_labels.get(event_type, event_type))
    severity = html.escape(str(alert.get("severity") or "MEDIUM"))
    payload = alert.get("payload") if isinstance(alert.get("payload"), dict) else {}
    symbol = html.escape(str(payload.get("symbol") or alert.get("asset_id") or "ASSET"))
    name_raw = str(payload.get("name") or "").strip()
    name_part = f" ({html.escape(name_raw)})" if name_raw and name_raw.upper() != symbol else ""
    track = html.escape(str(payload.get("track") or "EARLY"))
    horizon = html.escape(str(payload.get("horizon") or "SWING"))
    conf = str(payload.get("confidence_level") or "").strip()
    conf_part = f" · Confidence: <b>{html.escape(conf)}</b>" if conf else ""

    score = payload.get("adjusted_score")
    score_line = (
        f"{float(score):.1f}/100"
        if isinstance(score, (int, float)) and not isinstance(score, bool)
        else "—"
    )
    delta = payload.get("score_delta")
    delta_part = (
        f" (delta {float(delta):+.1f})"
        if isinstance(delta, (int, float)) and not isinstance(delta, bool)
        else ""
    )

    stats: list[str] = []
    price_str = _fmt_usd(payload.get("price"))
    if price_str:
        stats.append(f"Price: <code>{price_str}</code>")
    ret_24h = payload.get("return_24h")
    if isinstance(ret_24h, (int, float)) and not isinstance(ret_24h, bool):
        stats.append(f"24h: <code>{float(ret_24h):+.2f}%</code>")
    ret_7d = payload.get("return_7d")
    if isinstance(ret_7d, (int, float)) and not isinstance(ret_7d, bool):
        stats.append(f"7d: <code>{float(ret_7d):+.2f}%</code>")
    rs_7d = payload.get("rs_btc_7d")
    if isinstance(rs_7d, (int, float)) and not isinstance(rs_7d, bool):
        stats.append(f"RS vs BTC 7d: <code>{float(rs_7d):+.1f} pp</code>")
    mcap_str = _fmt_usd(payload.get("market_cap"))
    if mcap_str:
        stats.append(f"MCap: <code>{mcap_str}</code>")

    lines = [
        f"<b>CoinTrac · {label}</b> [{severity}]",
        f"<b>{symbol}</b>{name_part} · <code>{track}/{horizon}</code>",
        f"Score: <b>{score_line}</b>{delta_part}{conf_part}",
    ]
    if stats:
        lines.append(" | ".join(stats))
    return "\n".join(lines)


class TelegramNotifier:
    """Delivers formatted alerts to Telegram Bot API when credentials are configured."""

    def __init__(
        self,
        *,
        bot_token: str | None = None,
        default_chat_id: str | None = None,
        send_hook: SendHook | None = None,
    ) -> None:
        settings = get_settings()
        self._token = (
            bot_token if bot_token is not None else settings.telegram_bot_token.get_secret_value()
        ).strip()
        self._default_chat_id = (
            default_chat_id
            if default_chat_id is not None
            else settings.telegram_default_chat_id
        ).strip()
        self._send_hook = send_hook

    @property
    def is_configured(self) -> bool:
        return bool(self._token and self._default_chat_id) or self._send_hook is not None

    async def send_alert(
        self,
        alert: dict[str, object],
        *,
        chat_id: str | None = None,
    ) -> TelegramDispatchResult:
        target_chat = (chat_id or self._default_chat_id).strip()
        if self._send_hook is None and (not self._token or not target_chat):
            return TelegramDispatchResult(attempted=False, sent=False)

        text = format_hidden_gem_alert_html(alert)
        if self._send_hook is not None:
            try:
                ok = await self._send_hook(target_chat or "default", text)
                return TelegramDispatchResult(
                    attempted=True, sent=bool(ok), error=None if ok else "send_hook returned False"
                )
            except Exception as exc:
                return TelegramDispatchResult(
                    attempted=True, sent=False, error=exc.__class__.__name__
                )

        url = f"https://api.telegram.org/bot{self._token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    url,
                    json={
                        "chat_id": target_chat,
                        "text": text,
                        "parse_mode": "HTML",
                        "disable_web_page_preview": True,
                    },
                )
            if 200 <= resp.status_code < 300:
                return TelegramDispatchResult(attempted=True, sent=True)
            return TelegramDispatchResult(
                attempted=True,
                sent=False,
                error=f"Telegram HTTP {resp.status_code}",
            )
        except Exception as exc:
            logger.warning("telegram delivery error (%s)", exc.__class__.__name__)
            return TelegramDispatchResult(
                attempted=True, sent=False, error=exc.__class__.__name__
            )


_DEFAULT_NOTIFIER: TelegramNotifier | None = None
_INSTALLED_NOTIFIER: TelegramNotifier | None = None


def get_telegram_notifier() -> TelegramNotifier:
    global _DEFAULT_NOTIFIER
    if _INSTALLED_NOTIFIER is not None:
        return _INSTALLED_NOTIFIER
    if _DEFAULT_NOTIFIER is None:
        _DEFAULT_NOTIFIER = TelegramNotifier()
    return _DEFAULT_NOTIFIER


def install_telegram_notifier(notifier: TelegramNotifier | None) -> None:
    global _INSTALLED_NOTIFIER
    _INSTALLED_NOTIFIER = notifier


def reset_telegram_notifier() -> None:
    global _DEFAULT_NOTIFIER, _INSTALLED_NOTIFIER
    _DEFAULT_NOTIFIER = None
    _INSTALLED_NOTIFIER = None
