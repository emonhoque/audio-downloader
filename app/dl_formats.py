import copy

DEFAULT_AUDIO_FORMAT = "mp3"
DEFAULT_MP3_QUALITY = "320"
AUDIO_FORMATS = ("mp3", "m4a", "opus", "flac", "wav")
AUDIO_QUALITIES = {
    "mp3": frozenset(("320", "192", "128", "best")),
    "m4a": frozenset(("192", "128", "best")),
    "opus": frozenset(("best",)),
    "flac": frozenset(("best",)),
    "wav": frozenset(("best",)),
}
_LEGACY_DOWNLOAD_TYPES = frozenset(("video", "captions", "thumbnail"))
_LEGACY_NON_AUDIO_FORMATS = frozenset(
    (
        "",
        "any",
        "mp4",
        "ios",
        "thumbnail",
        "captions",
        "jpg",
        "srt",
        "txt",
        "vtt",
        "ttml",
        "sbv",
        "scc",
        "dfxp",
    )
)


def normalize_audio_request(
    download_type: str | None,
    format: str | None,
    quality: str | None,
) -> tuple[str, str, str, str]:
    """Return the authoritative audio-only settings for a new download.

    Supported explicit audio choices are preserved only when the request is
    already audio, or when the legacy schema omitted ``download_type`` and put
    an audio format directly in ``format``. Every obsolete video, captions, or
    thumbnail request becomes the product default instead of resurrecting the
    old media modes.
    """
    requested_type = str(download_type or "").strip().lower()
    requested_format = str(format or "").strip().lower()
    requested_quality = str(quality or "").strip().lower()

    if requested_type not in {"", "audio", *_LEGACY_DOWNLOAD_TYPES}:
        raise ValueError(f"Unknown download_type {requested_type}")

    explicit_audio_format = requested_type == "audio" or (
        requested_type == "" and requested_format in AUDIO_FORMATS
    )
    if explicit_audio_format:
        normalized_format = requested_format or DEFAULT_AUDIO_FORMAT
        if normalized_format not in AUDIO_FORMATS:
            raise ValueError(f"Unknown audio format {normalized_format}")
    else:
        if requested_type == "" and requested_format not in _LEGACY_NON_AUDIO_FORMATS:
            raise ValueError(f"Unknown audio format {requested_format}")
        normalized_format = DEFAULT_AUDIO_FORMAT

    if not explicit_audio_format:
        normalized_quality = DEFAULT_MP3_QUALITY
    elif requested_quality:
        normalized_quality = requested_quality
    elif normalized_format == DEFAULT_AUDIO_FORMAT:
        normalized_quality = DEFAULT_MP3_QUALITY
    else:
        normalized_quality = "best"

    if normalized_quality not in AUDIO_QUALITIES[normalized_format]:
        raise ValueError(
            f"Unknown audio quality {normalized_quality} for format {normalized_format}"
        )

    return "audio", "auto", normalized_format, normalized_quality


def coerce_legacy_audio_request(
    download_type: str | None,
    format: str | None,
    quality: str | None,
) -> tuple[str, str, str, str]:
    """Normalize persisted legacy settings, falling back safely to MP3."""
    try:
        return normalize_audio_request(download_type, format, quality)
    except ValueError:
        return "audio", "auto", DEFAULT_AUDIO_FORMAT, DEFAULT_MP3_QUALITY


def merge_ytdl_option_layers(presets, overrides, presets_config) -> dict:
    """Overlay named presets (in order) then per-item overrides onto a fresh dict.

    Does NOT include any base ``YTDL_OPTIONS`` — callers layer this on top of
    their own base (a per-download build adds the global base; a subscription
    scan relies on ``**config.YTDL_OPTIONS`` already being present in its
    params). ``presets_config`` maps a preset name to its options dict.
    """
    merged: dict = {}
    for name in presets or []:
        merged.update(presets_config.get(name, {}))
    merged.update(overrides or {})
    return merged


def get_format(download_type: str, codec: str, format: str, quality: str) -> str:
    """Return the best source-audio selector for the normalized request."""
    _download_type, _codec, normalized_format, _quality = normalize_audio_request(
        download_type, format, quality
    )
    return f"bestaudio[ext={normalized_format}]/bestaudio/best"


def get_opts(
    download_type: str,
    _codec: str,
    format: str,
    quality: str,
    ytdl_opts: dict,
    subtitle_language: str = "en",
    subtitle_mode: str = "prefer_manual",
) -> dict:
    """Add mandatory FFmpeg audio extraction and useful artwork metadata."""
    del subtitle_language, subtitle_mode
    _download_type, _codec, format, quality = normalize_audio_request(
        download_type, format, quality
    )
    opts = copy.deepcopy(ytdl_opts)

    postprocessors = [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": format,
            "preferredquality": 0 if quality == "best" else quality,
        }
    ]

    if format != "wav" and "writethumbnail" not in opts:
        opts["writethumbnail"] = True
        postprocessors.append(
            {
                "key": "FFmpegThumbnailsConvertor",
                "format": "jpg",
                "when": "before_dl",
            }
        )
        postprocessors.append({"key": "FFmpegMetadata"})
        postprocessors.append({"key": "EmbedThumbnail"})

    opts["postprocessors"] = postprocessors + (
        opts["postprocessors"] if "postprocessors" in opts else []
    )
    return opts
