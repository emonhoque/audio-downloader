"""Tests for nightly yt-dlp update scheduling helpers."""

from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import main
from main import seconds_until_next_daily_time


class NightlyUpdateTests(unittest.TestCase):
    def test_seconds_until_later_today(self):
        now = datetime(2026, 6, 4, 10, 0, 0)
        delay = seconds_until_next_daily_time("15:30", now)
        self.assertEqual(delay, 5 * 3600 + 30 * 60)

    def test_seconds_until_wraps_to_next_day(self):
        now = datetime(2026, 6, 4, 18, 0, 0)
        delay = seconds_until_next_daily_time("04:00", now)
        self.assertEqual(delay, 10 * 3600)

    def test_seconds_until_same_minute_is_next_day(self):
        now = datetime(2026, 6, 4, 4, 0, 30)
        delay = seconds_until_next_daily_time("04:00", now)
        self.assertAlmostEqual(delay, 24 * 3600 - 30, delta=1)


class NightlyUpdateScheduleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_time = main.config.YTDL_NIGHTLY_UPDATE_TIME
        self.original_restart = main._RESTART_FOR_UPDATE

    async def asyncTearDown(self):
        main.config.YTDL_NIGHTLY_UPDATE_TIME = self.original_time
        main._RESTART_FOR_UPDATE = self.original_restart

    async def test_disabled_schedule_returns_without_sleeping_or_restarting(self):
        main.config.YTDL_NIGHTLY_UPDATE_TIME = ""
        main._RESTART_FOR_UPDATE = False
        with patch("main.asyncio.sleep", new=AsyncMock()) as sleep, patch(
            "main._request_graceful_exit"
        ) as restart:
            await main._schedule_nightly_update()

        sleep.assert_not_awaited()
        restart.assert_not_called()
        self.assertFalse(main._RESTART_FOR_UPDATE)

    async def test_enabled_schedule_waits_then_requests_supervised_restart(self):
        main.config.YTDL_NIGHTLY_UPDATE_TIME = "04:00"
        main._RESTART_FOR_UPDATE = False
        loop = MagicMock()
        with patch("main.seconds_until_next_daily_time", return_value=123), patch(
            "main.asyncio.sleep", new=AsyncMock()
        ) as sleep, patch("main.dqueue.has_active_downloads", return_value=False), patch(
            "main.asyncio.get_running_loop", return_value=loop
        ), patch("main._request_graceful_exit") as restart:
            await main._schedule_nightly_update()

        sleep.assert_awaited_once_with(123)
        loop.call_soon.assert_called_once_with(restart)
        self.assertTrue(main._RESTART_FOR_UPDATE)

    async def test_due_update_waits_for_active_download_before_restart(self):
        main.config.YTDL_NIGHTLY_UPDATE_TIME = "04:00"
        loop = MagicMock()
        with patch("main.seconds_until_next_daily_time", return_value=1), patch(
            "main.asyncio.sleep", new=AsyncMock()
        ) as sleep, patch(
            "main.dqueue.has_active_downloads", side_effect=[True, True, False]
        ), patch("main.asyncio.get_running_loop", return_value=loop), patch(
            "main._request_graceful_exit"
        ) as restart:
            await main._schedule_nightly_update()

        self.assertEqual(sleep.await_args_list[0].args, (1,))
        self.assertEqual(sleep.await_args_list[1].args, (30,))
        loop.call_soon.assert_called_once_with(restart)


if __name__ == "__main__":
    unittest.main()
