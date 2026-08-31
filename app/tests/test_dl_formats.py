"""Tests for the audio-only yt-dlp format and option contract."""

from __future__ import annotations

import copy
import unittest

from app.dl_formats import (
    AUDIO_FORMATS,
    DEFAULT_AUDIO_FORMAT,
    DEFAULT_MP3_QUALITY,
    coerce_legacy_audio_request,
    get_format,
    get_opts,
    merge_ytdl_option_layers,
    normalize_audio_request,
)


class AudioNormalizationTests(unittest.TestCase):
    def test_missing_fields_default_to_mp3_best(self):
        self.assertEqual(
            normalize_audio_request(None, None, None),
            ("audio", "auto", DEFAULT_AUDIO_FORMAT, DEFAULT_MP3_QUALITY),
        )

    def test_all_supported_audio_formats_are_preserved(self):
        for fmt in AUDIO_FORMATS:
            with self.subTest(fmt=fmt):
                expected_quality = "best"
                self.assertEqual(
                    normalize_audio_request("audio", fmt, None),
                    ("audio", "auto", fmt, expected_quality),
                )

    def test_explicit_mp3_qualities_are_preserved(self):
        for quality in ("320", "192", "128", "best"):
            with self.subTest(quality=quality):
                self.assertEqual(
                    normalize_audio_request("audio", "mp3", quality),
                    ("audio", "auto", "mp3", quality),
                )

    def test_legacy_media_modes_become_mp3_best(self):
        for download_type, fmt in (
            ("video", "mp4"),
            ("captions", "srt"),
            ("thumbnail", "jpg"),
        ):
            with self.subTest(download_type=download_type):
                self.assertEqual(
                    normalize_audio_request(download_type, fmt, "best"),
                    ("audio", "auto", "mp3", "best"),
                )

    def test_legacy_schema_preserves_explicit_audio_format(self):
        self.assertEqual(
            normalize_audio_request(None, "m4a", "best"),
            ("audio", "auto", "m4a", "best"),
        )

    def test_unknown_format_is_rejected_for_new_audio_request(self):
        with self.assertRaises(ValueError):
            normalize_audio_request("audio", "aac", "best")

    def test_invalid_quality_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_audio_request("audio", "mp3", "999")

    def test_persisted_invalid_record_is_safely_coerced(self):
        self.assertEqual(
            coerce_legacy_audio_request("audio", "invalid", "invalid"),
            ("audio", "auto", "mp3", "best"),
        )


class DlFormatsTests(unittest.TestCase):
    def test_source_selector_is_audio_only(self):
        selector = get_format("audio", "auto", "mp3", "320")
        self.assertEqual(selector, "bestaudio[ext=mp3]/bestaudio/best")
        self.assertNotIn("bestvideo", selector)

    def test_legacy_video_selector_is_still_audio_only(self):
        selector = get_format("video", "h264", "mp4", "1080")
        self.assertEqual(selector, "bestaudio[ext=mp3]/bestaudio/best")

    def test_all_audio_formats_have_a_source_preference(self):
        for fmt in AUDIO_FORMATS:
            with self.subTest(fmt=fmt):
                self.assertIn(f"ext={fmt}", get_format("audio", "auto", fmt, None))

    def test_mp3_default_conversion_is_320_kbps(self):
        opts = get_opts("audio", "auto", "mp3", "320", {})
        extractor = next(p for p in opts["postprocessors"] if p["key"] == "FFmpegExtractAudio")
        self.assertEqual(extractor["preferredcodec"], "mp3")
        self.assertEqual(extractor["preferredquality"], "320")

    def test_lossless_and_best_quality_use_ffmpeg_best_setting(self):
        for fmt in ("m4a", "opus", "flac", "wav"):
            with self.subTest(fmt=fmt):
                opts = get_opts("audio", "auto", fmt, "best", {})
                extractor = next(
                    p for p in opts["postprocessors"] if p["key"] == "FFmpegExtractAudio"
                )
                self.assertEqual(extractor["preferredcodec"], fmt)
                self.assertEqual(extractor["preferredquality"], 0)

    def test_wav_does_not_request_thumbnail_embedding(self):
        opts = get_opts("audio", "auto", "wav", "best", {})
        self.assertNotIn("writethumbnail", opts)
        self.assertNotIn("EmbedThumbnail", [p["key"] for p in opts["postprocessors"]])

    def test_mp3_requests_metadata_and_thumbnail_embedding(self):
        opts = get_opts("audio", "auto", "mp3", "320", {})
        keys = [p["key"] for p in opts["postprocessors"]]
        self.assertTrue(opts["writethumbnail"])
        self.assertIn("FFmpegMetadata", keys)
        self.assertIn("EmbedThumbnail", keys)

    def test_get_opts_deepcopy_does_not_mutate_input(self):
        base = {"postprocessors": [{"key": "Existing"}]}
        original = copy.deepcopy(base)
        get_opts("audio", "auto", "mp3", "320", base)
        self.assertEqual(base, original)

    def test_user_postprocessors_follow_mandatory_audio_conversion(self):
        opts = get_opts(
            "audio", "auto", "opus", "best", {"postprocessors": [{"key": "SponsorBlock"}]}
        )
        keys = [p["key"] for p in opts["postprocessors"]]
        self.assertEqual(keys[0], "FFmpegExtractAudio")
        self.assertIn("SponsorBlock", keys)


class MergeYtdlOptionLayersTests(unittest.TestCase):
    def test_presets_applied_in_order_then_overrides(self):
        presets_config = {
            "a": {"x": 1, "y": 1},
            "b": {"y": 2, "z": 2},
        }
        merged = merge_ytdl_option_layers(["a", "b"], {"z": 3, "w": 4}, presets_config)
        self.assertEqual(merged, {"x": 1, "y": 2, "z": 3, "w": 4})

    def test_no_base_options_included(self):
        self.assertEqual(merge_ytdl_option_layers(None, None, {}), {})

    def test_unknown_preset_names_ignored(self):
        self.assertEqual(merge_ytdl_option_layers(["missing"], {"a": 1}, {}), {"a": 1})


if __name__ == "__main__":
    unittest.main()
