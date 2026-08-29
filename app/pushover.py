"""Failure-safe Pushover notifications for the private Audio Downloader fork."""

from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from collections.abc import Callable

import aiohttp


log = logging.getLogger("pushover")

PUSHOVER_MESSAGES_URL = "https://api.pushover.net/1/messages.json"
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def _notification_text(value: object) -> str:
    """Collapse untrusted text and remove URLs before it leaves the server."""
    text = " ".join(str(value or "").split())
    return _URL_RE.sub("[URL omitted]", text)


def _truncate_utf8(value: str, max_bytes: int) -> str:
    """Respect Pushover's byte limits without splitting a UTF-8 character."""
    encoded = value.encode("utf-8")
    if len(encoded) <= max_bytes:
        return value
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


class PushoverNotifier:
    """Send throttled alerts without allowing notification failures to escape."""

    def __init__(
        self,
        app_token: str,
        user_key: str,
        *,
        session_factory=aiohttp.ClientSession,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._app_token = app_token.strip()
        self._user_key = user_key.strip()
        self._session_factory = session_factory
        self._clock = clock
        self._send_lock = asyncio.Lock()
        self._last_success: dict[str, float] = {}

        if bool(self._app_token) != bool(self._user_key):
            log.warning(
                "Pushover is disabled because both PUSHOVER_APP_TOKEN and "
                "PUSHOVER_USER_KEY must be configured"
            )

    @property
    def configured(self) -> bool:
        return bool(self._app_token and self._user_key)

    async def _send(
        self,
        *,
        category: str,
        title: str,
        message: str,
        cooldown_seconds: int,
    ) -> tuple[bool, str]:
        if not self.configured:
            return (
                False,
                "Problem reporting is not configured. Check the server notification settings.",
            )

        title = _truncate_utf8(_notification_text(title), 250)
        message = _truncate_utf8(_notification_text(message), 1024)

        async with self._send_lock:
            now = self._clock()
            previous = self._last_success.get(category)
            if previous is not None:
                remaining = cooldown_seconds - (now - previous)
                if remaining > 0:
                    return (
                        False,
                        f"A notification was just sent. Try again in {math.ceil(remaining)} seconds.",
                    )

            try:
                timeout = aiohttp.ClientTimeout(total=10)
                async with self._session_factory(timeout=timeout) as session:
                    async with session.post(
                        PUSHOVER_MESSAGES_URL,
                        data={
                            "token": self._app_token,
                            "user": self._user_key,
                            "title": title,
                            "message": message,
                        },
                    ) as response:
                        payload = await response.json(content_type=None)

                accepted = (
                    response.status == 200
                    and isinstance(payload, dict)
                    and payload.get("status") == 1
                )
                if accepted:
                    self._last_success[category] = now
                    return True, "Problem report sent."

                log.warning("Pushover rejected a notification with HTTP status %s", response.status)
                return False, "The notification service rejected the problem report. Check its settings."
            except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, TypeError):
                log.warning("Could not send a Pushover notification", exc_info=True)
                return False, "Could not reach the notification service. Check the server logs."
            except Exception:  # Notification code must never affect a download.
                log.exception("Unexpected error while sending a Pushover notification")
                return False, "Could not send the problem report. Check the server logs."

    async def notify_manual_report(self, *, app_version: str, yt_dlp_version: str) -> tuple[bool, str]:
        return await self._send(
            category="manual-report",
            title="Audio Downloader: problem reported",
            message=(
                "A user reported that Audio Downloader is not working. "
                f"App version: {app_version}. yt-dlp version: {yt_dlp_version}."
            ),
            cooldown_seconds=60,
        )

    async def notify_download_failure(self, download) -> tuple[bool, str]:
        title = _notification_text(getattr(download, "title", "")) or "Unknown download"
        reason = _notification_text(getattr(download, "msg", "")) or "yt-dlp reported a failure"
        return await self._send(
            category="download-failure",
            title="Audio Downloader: download failed",
            message=f"Download failed: {title}. Error: {reason}",
            cooldown_seconds=300,
        )
