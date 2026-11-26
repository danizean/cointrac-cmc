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


def format_hidden_gem_alert_html(alert: dict[str, object]) -> str:
    """Format an hg_alert_events row as HTML-escaped Telegram message text."""
    event_type = html.escape(str(alert.get("event_type") or "NEW_DISCOVERY"))
    severity = html.escape(str(alert.get("severity") or "MEDIUM"))
    payload = alert.get("payload") if isinstance(alert.get("payload"), dict) else {}
    symbol = html.escape(str(payload.get("symbol") or alert.get("asset_id") or "ASSET"))
    track = html.escape(str(payload.get("track") or "EARLY"))
    horizon = html.escape(str(payload.get("horizon") or "SWING"))
    score = payload.get("adjusted_score")
    score_line = f"{float(score):.1f}/100" if isinstance(score, (int, float)) else "—"
    delta = payload.get("score_delta")
    delta_part = (
        f" (delta {float(delta):+.1f})" if isinstance(delta, (int, float)) else ""
    )
    return (
        f"<b>CoinTrac Hidden Gem · {event_type}</b>\n"
        f"Asset: <code>{symbol}</code> · Track: <code>{track}/{horizon}</code>\n"
        f"Severity: <b>{severity}</b> · Score: <b>{score_line}</b>{delta_part}"
    )


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
