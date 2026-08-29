"""Tests for the private fork's failure-safe Pushover integration."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from pushover import PUSHOVER_MESSAGES_URL, PushoverNotifier


class FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status = status
        self.payload = payload if payload is not None else {"status": 1}

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def json(self, *, content_type=None):
        return self.payload


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.posts = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def post(self, url, *, data):
        self.posts.append((url, data))
        return self.response


class FakeSessionFactory:
    def __init__(self, response=None):
        self.session = FakeSession(response or FakeResponse())
        self.timeouts = []

    def __call__(self, *, timeout):
        self.timeouts.append(timeout)
        return self.session


@pytest.mark.asyncio
async def test_unconfigured_notifier_does_not_open_http_session():
    def fail_factory(**kwargs):
        raise AssertionError("HTTP must not be attempted without both credentials")

    notifier = PushoverNotifier("", "", session_factory=fail_factory)
    success, msg = await notifier.notify_manual_report(app_version="dev", yt_dlp_version="1")

    assert success is False
    assert "not configured" in msg


@pytest.mark.asyncio
async def test_download_failure_posts_credentials_and_redacts_urls():
    factory = FakeSessionFactory()
    notifier = PushoverNotifier("app-token", "user-key", session_factory=factory)
    download = SimpleNamespace(
        title="Example track",
        msg="Extractor failed at https://example.com/private?id=123",
    )

    success, msg = await notifier.notify_download_failure(download)

    assert success is True
    assert msg == "Problem report sent."
    assert len(factory.session.posts) == 1
    url, data = factory.session.posts[0]
    assert url == PUSHOVER_MESSAGES_URL
    assert data["token"] == "app-token"
    assert data["user"] == "user-key"
    assert "Example track" in data["message"]
    assert "https://" not in data["message"]
    assert "[URL omitted]" in data["message"]


@pytest.mark.asyncio
async def test_successful_notifications_are_throttled_by_category():
    now = [100.0]
    factory = FakeSessionFactory()
    notifier = PushoverNotifier(
        "app-token",
        "user-key",
        session_factory=factory,
        clock=lambda: now[0],
    )

    first = await notifier.notify_manual_report(app_version="dev", yt_dlp_version="1")
    now[0] += 5
    second = await notifier.notify_manual_report(app_version="dev", yt_dlp_version="1")

    assert first[0] is True
    assert second == (False, "A notification was just sent. Try again in 55 seconds.")
    assert len(factory.session.posts) == 1


@pytest.mark.asyncio
async def test_rejected_notification_returns_error_without_throttling_retry():
    factory = FakeSessionFactory(FakeResponse(status=400, payload={"status": 0}))
    notifier = PushoverNotifier("bad-token", "user-key", session_factory=factory)

    first = await notifier.notify_manual_report(app_version="dev", yt_dlp_version="1")
    second = await notifier.notify_manual_report(app_version="dev", yt_dlp_version="1")

    assert first[0] is False
    assert second[0] is False
    assert len(factory.session.posts) == 2


@pytest.mark.asyncio
async def test_unexpected_http_error_is_swallowed():
    def broken_factory(**kwargs):
        raise RuntimeError("network setup failed")

    notifier = PushoverNotifier("app-token", "user-key", session_factory=broken_factory)

    success, msg = await notifier.notify_download_failure(SimpleNamespace(title="Track", msg="bad"))

    assert success is False
    assert "server logs" in msg
