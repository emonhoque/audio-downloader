"""Tests for pure helpers in ``main`` (legacy API migration, logging, JSON serializer)."""

from __future__ import annotations

import json
import logging
import unittest

import main


class MigrateLegacyRequestTests(unittest.TestCase):
    def test_explicit_audio_schema_unchanged(self):
        post = {"download_type": "audio", "codec": "auto", "format": "opus", "quality": "best"}
        before = post.copy()
        self.assertIs(main._migrate_legacy_request(post), post)
        self.assertEqual(post, before)

    def test_legacy_audio_m4a(self):
        post = {"format": "m4a", "quality": "best"}
        main._migrate_legacy_request(post)
        self.assertEqual(post["download_type"], "audio")
        self.assertEqual(post["codec"], "auto")
        self.assertEqual(post["format"], "m4a")

    def test_legacy_non_audio_requests_become_mp3_320(self):
        for post in (
            {"format": "thumbnail", "quality": "best"},
            {"format": "captions", "subtitle_format": "vtt", "quality": "best"},
            {"format": "any", "quality": "best_ios", "video_codec": "auto"},
            {"format": "mp4", "quality": "1080", "video_codec": "h265"},
        ):
            with self.subTest(post=post):
                main._migrate_legacy_request(post)
                self.assertEqual(post["download_type"], "audio")
                self.assertEqual(post["codec"], "auto")
                self.assertEqual(post["format"], "mp3")
                self.assertEqual(post["quality"], "320")

    def test_legacy_audio_quality_marker_becomes_mp3_320(self):
        post = {"format": "mp4", "quality": "audio", "video_codec": "h264"}
        main._migrate_legacy_request(post)
        self.assertEqual(post["download_type"], "audio")
        self.assertEqual(post["format"], "mp3")
        self.assertEqual(post["quality"], "320")


class ParseLogLevelTests(unittest.TestCase):
    def test_valid_levels(self):
        self.assertEqual(main.parseLogLevel("INFO"), logging.INFO)
        self.assertEqual(main.parseLogLevel("debug"), logging.DEBUG)

    def test_invalid_returns_none(self):
        self.assertIsNone(main.parseLogLevel("not_a_level"))
        self.assertIsNone(main.parseLogLevel(123))


class ObjectSerializerTests(unittest.TestCase):
    def test_dict_like_object(self):
        class Obj:
            def __init__(self):
                self.a = 1

        ser = main.ObjectSerializer()
        self.assertEqual(json.loads(ser.encode(Obj())), {"a": 1})

    def test_generator_becomes_list(self):
        ser = main.ObjectSerializer()

        def gen():
            yield 1
            yield 2

        self.assertEqual(json.loads(ser.encode(gen())), [1, 2])

    def test_string_not_split_to_chars(self):
        ser = main.ObjectSerializer()
        self.assertEqual(json.loads(ser.encode("hello")), "hello")


class FrontendSafeTests(unittest.TestCase):
    def test_only_expected_keys(self):
        safe = main.config.frontend_safe()
        for key in main.Config._FRONTEND_KEYS:
            self.assertIn(key, safe)
        self.assertNotIn("YTDL_OPTIONS", safe)
        self.assertNotIn("DOWNLOAD_DIR", safe)
        self.assertNotIn("PUSHOVER_APP_TOKEN", safe)
        self.assertNotIn("PUSHOVER_USER_KEY", safe)
        self.assertIn("ALLOW_YTDL_OPTIONS_OVERRIDES", safe)


class ParseYtdlOverridesTests(unittest.TestCase):
    def test_empty_override_string_returns_empty_dict(self):
        self.assertEqual(main._parse_ytdl_options_overrides("", enabled=False), {})

    def test_rejects_non_object_json(self):
        with self.assertRaises(main.web.HTTPBadRequest):
            main._parse_ytdl_options_overrides('["bad"]', enabled=True)

    def test_rejects_non_empty_overrides_when_disabled(self):
        with self.assertRaises(main.web.HTTPBadRequest):
            main._parse_ytdl_options_overrides('{"exec": "rm -rf /"}', enabled=False)

    def test_allows_any_keys_when_enabled(self):
        self.assertEqual(
            main._parse_ytdl_options_overrides('{"exec": "rm -rf /"}', enabled=True),
            {"exec": "rm -rf /"},
        )


class ParseDownloadOptionsTests(unittest.TestCase):
    def test_missing_media_fields_default_to_mp3_320(self):
        parsed = main.parse_download_options({"url": "https://example.com/v"})
        self.assertEqual(parsed["download_type"], "audio")
        self.assertEqual(parsed["codec"], "auto")
        self.assertEqual(parsed["format"], "mp3")
        self.assertEqual(parsed["quality"], "320")

    def test_explicit_alternate_audio_format_is_preserved(self):
        parsed = main.parse_download_options({
            "url": "https://example.com/v",
            "format": "flac",
            "quality": "best",
        })
        self.assertEqual(parsed["download_type"], "audio")
        self.assertEqual(parsed["format"], "flac")
        self.assertEqual(parsed["quality"], "best")

    def test_explicit_invalid_audio_format_is_rejected(self):
        with self.assertRaises(main.web.HTTPBadRequest):
            main.parse_download_options({
                "url": "https://example.com/v",
                "download_type": "audio",
                "format": "aac",
                "quality": "best",
            })

    def test_obsolete_video_fields_are_forced_to_mp3_320(self):
        parsed = main.parse_download_options({
            "url": "https://example.com/v",
            "download_type": "video",
            "codec": "h264",
            "format": "mp4",
            "quality": "1080",
        })
        self.assertEqual(parsed["download_type"], "audio")
        self.assertEqual(parsed["codec"], "auto")
        self.assertEqual(parsed["format"], "mp3")
        self.assertEqual(parsed["quality"], "320")

    def test_accepts_known_preset_and_overrides(self):
        previous = dict(main.config.YTDL_OPTIONS_PRESETS)
        previous_allow = main.config.ALLOW_YTDL_OPTIONS_OVERRIDES
        main.config.YTDL_OPTIONS_PRESETS = {"With subtitles": {"writesubtitles": True}}
        main.config.ALLOW_YTDL_OPTIONS_OVERRIDES = True
        try:
            parsed = main.parse_download_options({
                "url": "https://example.com/v",
                "download_type": "video",
                "codec": "auto",
                "format": "any",
                "quality": "best",
                "ytdl_options_preset": "With subtitles",
                "ytdl_options_overrides": '{"writesubtitles": true}',
            })
        finally:
            main.config.YTDL_OPTIONS_PRESETS = previous
            main.config.ALLOW_YTDL_OPTIONS_OVERRIDES = previous_allow
        self.assertEqual(parsed["ytdl_options_presets"], ["With subtitles"])
        self.assertEqual(parsed["ytdl_options_overrides"], {"writesubtitles": True})

    def test_accepts_multiple_presets_in_order(self):
        previous = dict(main.config.YTDL_OPTIONS_PRESETS)
        main.config.YTDL_OPTIONS_PRESETS = {
            "A": {"writesubtitles": True},
            "B": {"writesubtitles": False},
        }
        try:
            parsed = main.parse_download_options({
                "url": "https://example.com/v",
                "download_type": "video",
                "codec": "auto",
                "format": "any",
                "quality": "best",
                "ytdl_options_presets": ["A", "B"],
            })
        finally:
            main.config.YTDL_OPTIONS_PRESETS = previous
        self.assertEqual(parsed["ytdl_options_presets"], ["A", "B"])

    def test_legacy_singular_preset_string_normalized_to_list(self):
        previous = dict(main.config.YTDL_OPTIONS_PRESETS)
        main.config.YTDL_OPTIONS_PRESETS = {"Solo": {}}
        try:
            parsed = main.parse_download_options({
                "url": "https://example.com/v",
                "download_type": "video",
                "codec": "auto",
                "format": "any",
                "quality": "best",
                "ytdl_options_preset": "Solo",
            })
        finally:
            main.config.YTDL_OPTIONS_PRESETS = previous
        self.assertEqual(parsed["ytdl_options_presets"], ["Solo"])

    def test_rejects_unknown_preset(self):
        with self.assertRaises(main.web.HTTPBadRequest):
            main.parse_download_options({
                "url": "https://example.com/v",
                "download_type": "video",
                "codec": "auto",
                "format": "any",
                "quality": "best",
                "ytdl_options_presets": ["Missing preset"],
            })

    def test_rejects_unknown_preset_in_list(self):
        previous = dict(main.config.YTDL_OPTIONS_PRESETS)
        main.config.YTDL_OPTIONS_PRESETS = {"Known": {}}
        try:
            with self.assertRaises(main.web.HTTPBadRequest):
                main.parse_download_options({
                    "url": "https://example.com/v",
                    "download_type": "video",
                    "codec": "auto",
                    "format": "any",
                    "quality": "best",
                    "ytdl_options_presets": ["Known", "Nope"],
                })
        finally:
            main.config.YTDL_OPTIONS_PRESETS = previous

    def test_clip_start_end_seconds_and_clock(self):
        parsed = main.parse_download_options({
            "url": "https://example.com/watch?v=1",
            "download_type": "video",
            "codec": "auto",
            "format": "any",
            "quality": "best",
            "clip_start": "2:26",
            "clip_end": "3:24",
        })
        self.assertEqual(parsed["clip_start"], 146.0)
        self.assertEqual(parsed["clip_end"], 204.0)

    def test_clip_url_t_param_strips_query_and_sets_start(self):
        parsed = main.parse_download_options({
            "url": "https://www.youtube.com/watch?v=1&t=855s",
            "download_type": "video",
            "codec": "auto",
            "format": "any",
            "quality": "best",
        })
        self.assertEqual(parsed["url"], "https://www.youtube.com/watch?v=1")
        self.assertEqual(parsed["clip_start"], 855.0)
        self.assertIsNone(parsed["clip_end"])

    def test_clip_explicit_start_wins_over_url_t(self):
        parsed = main.parse_download_options({
            "url": "https://www.youtube.com/watch?v=1&t=100",
            "download_type": "video",
            "codec": "auto",
            "format": "any",
            "quality": "best",
            "clip_start": "50",
        })
        self.assertEqual(parsed["url"], "https://www.youtube.com/watch?v=1")
        self.assertEqual(parsed["clip_start"], 50.0)
        self.assertIsNone(parsed["clip_end"])

    def test_clip_end_only_sets_start_zero_and_strips_url_t(self):
        parsed = main.parse_download_options({
            "url": "https://www.youtube.com/watch?v=1&t=999",
            "download_type": "video",
            "codec": "auto",
            "format": "any",
            "quality": "best",
            "clip_end": "60",
        })
        self.assertEqual(parsed["url"], "https://www.youtube.com/watch?v=1")
        self.assertEqual(parsed["clip_start"], 0.0)
        self.assertEqual(parsed["clip_end"], 60.0)

    def test_clip_url_t_param_ignored_on_non_youtube_host(self):
        # 't' is a generic query param name; only rewrite it on YouTube hosts
        # so an unrelated site's URL isn't silently mutated with a bogus clip.
        parsed = main.parse_download_options({
            "url": "https://example.com/watch?v=1&t=855s",
            "download_type": "video",
            "codec": "auto",
            "format": "any",
            "quality": "best",
        })
        self.assertEqual(parsed["url"], "https://example.com/watch?v=1&t=855s")
        self.assertIsNone(parsed["clip_start"])
        self.assertIsNone(parsed["clip_end"])

    def test_extract_t_query_youtu_be_short_host(self):
        cleaned, start = main._extract_t_query_from_url("https://youtu.be/abc123?t=90")
        self.assertEqual(cleaned, "https://youtu.be/abc123")
        self.assertEqual(start, 90.0)

    def test_clip_rejects_end_before_start(self):
        with self.assertRaises(main.web.HTTPBadRequest):
            main.parse_download_options({
                "url": "https://example.com/watch?v=1",
                "download_type": "video",
                "codec": "auto",
                "format": "any",
                "quality": "best",
                "clip_start": "100",
                "clip_end": "50",
            })

    def test_clip_for_legacy_captions_request_applies_to_default_audio(self):
        parsed = main.parse_download_options({
            "url": "https://example.com/watch?v=1",
            "download_type": "captions",
            "codec": "auto",
            "format": "srt",
            "quality": "best",
            "clip_start": "1",
        })
        self.assertEqual(parsed["download_type"], "audio")
        self.assertEqual(parsed["format"], "mp3")
        self.assertEqual(parsed["clip_start"], 1.0)


class GetCustomDirsTests(unittest.TestCase):
    def test_works_without_a_running_event_loop(self):
        # get_custom_dirs() used to time its cache via
        # asyncio.get_running_loop().time(), which raises RuntimeError outside
        # a running loop (e.g. when called from a plain executor thread). It
        # must work from a synchronous context too.
        result = main.get_custom_dirs()
        self.assertIn("download_dir", result)
        self.assertIn("audio_download_dir", result)
        self.assertIn("", result["download_dir"])


if __name__ == "__main__":
    unittest.main()


class WarnIfCookiefileShadowedTests(unittest.TestCase):
    """Issue #881: an uploaded cookies file wins over an operator-configured
    cookiefile, and used to do so with no way for anyone to notice."""

    def setUp(self):
        self._saved = main.config.YTDL_OPTIONS
        main.config.YTDL_OPTIONS = dict(self._saved)

    def tearDown(self):
        main.config.YTDL_OPTIONS = self._saved

    def test_warns_when_a_different_cookiefile_is_configured(self):
        main.config.YTDL_OPTIONS["cookiefile"] = "/cookies/cookies.txt"
        with self.assertLogs("main", level="WARNING") as cm:
            main.warn_if_cookiefile_shadowed()
        joined = "\n".join(cm.output)
        self.assertIn("/cookies/cookies.txt", joined)
        self.assertIn(main.COOKIES_PATH, joined)

    def test_silent_when_no_cookiefile_configured(self):
        main.config.YTDL_OPTIONS.pop("cookiefile", None)
        with self.assertNoLogs("main", level="WARNING"):
            main.warn_if_cookiefile_shadowed()

    def test_silent_when_configured_file_is_the_uploaded_one(self):
        # The steady state after an upload: re-running must not nag.
        main.config.YTDL_OPTIONS["cookiefile"] = main.COOKIES_PATH
        with self.assertNoLogs("main", level="WARNING"):
            main.warn_if_cookiefile_shadowed()

    def test_silent_on_non_string_or_empty_values(self):
        for value in (None, "", 0, [], {}):
            main.config.YTDL_OPTIONS["cookiefile"] = value
            with self.assertNoLogs("main", level="WARNING"):
                main.warn_if_cookiefile_shadowed()
