# Audio Downloader

Audio Downloader is an audio-only fork of [MeTube](https://github.com/alexta69/metube), built around [yt-dlp](https://github.com/yt-dlp/yt-dlp).

The goal is simple: paste a supported URL, choose an audio format if you want something other than the default, and get a correctly written audio file. Video, caption-only, and thumbnail-only downloads are intentionally not part of this fork.

## Highlights

- Audio-only download pipeline enforced by the backend.
- MP3 at 320 kbps by default.
- MP3, M4A, Opus, FLAC, and WAV output.
- Redesigned responsive Audio Downloader UI.
- Playlist and channel URL support through yt-dlp.
- Persistent queue and download history.
- Searchable and sortable History with thumbnails, source icons, file details, retry, redownload, delete, and source links.
- Downloading panel appears only while work exists and moves below History on mobile.
- Duplicate URL detection for previously downloaded items.
- Paste-from-clipboard support.
- Conservative music metadata enrichment using only metadata already supplied by yt-dlp.
- Automatic yt-dlp updates in running containers.
- Daily repository-level yt-dlp dependency updates and multi-architecture GHCR builds.
- Optional server-side administrator notifications for failed downloads and manual problem reports.
- Light, dark, and automatic themes.

## Default Behavior

The default download is:

```text
Format:  MP3
Quality: 320 kbps
```

A URL-only request is normalized to audio even if an older client sends legacy video fields. The backend is authoritative, so compatibility fields cannot turn this fork back into a video downloader.

Format selection precedence is:

1. A supported audio format explicitly chosen for the current request.
2. A previously saved supported audio selection.
3. MP3.

Unsupported explicit audio formats are rejected. Ambiguous legacy media settings fall back to MP3.

## Supported Audio Formats

| Format | Available quality |
| --- | --- |
| MP3 | 320, 192, or 128 kbps |
| M4A | Best, 192, or 128 kbps |
| Opus | Best |
| FLAC | Best |
| WAV | Best |

`Best` leaves the numeric bitrate target unset and lets the existing yt-dlp and FFmpeg pipeline produce the selected output format from the best available source audio.

The fork does not add an extra lossy intermediate. The general pipeline is:

```text
best available source audio
        |
        v
yt-dlp audio selection
        |
        v
FFmpegExtractAudio
        |
        v
selected output format
```

MP3 at 320 kbps is a target output bitrate. It cannot restore detail that is not present in the source.

## Current Web UI

The main screen is intentionally focused on the download workflow rather than exposing every inherited MeTube feature at once.

### Add a link

The composer provides:

- URL input with a Paste button.
- Automatic source recognition and site favicon display.
- Format and quality selectors.
- One-click Start download action.
- Duplicate detection when the same URL already exists in History.


### Downloading

The Downloading panel is contextual. It is not rendered when the queue is idle.

While work exists it shows the active or queued jobs, state, progress, format, speed, ETA, and relevant actions. On narrow screens it appears below History rather than above it.

### History

Finished and failed downloads appear in History.

History supports:

- Search by title, artist, source, format, filename, or status.
- Sort by newest, oldest, name, largest, or smallest.
- Thumbnail with initials fallback.
- Source favicon in metadata.
- Artist or uploader when available.
- Format, size, and timestamp metadata.
- Download or retry as the primary row action.
- Expandable details for filename, source URL, timestamps, errors, and chapter files.
- Open source, download again, share where supported, copy error, and delete actions.

The old permanent format and failed-status filter tabs are intentionally not part of this UI. Search and sorting handle History discovery without keeping extra navigation visible all the time.

### Footer and problem reporting

The footer shows the running yt-dlp version and, when available, the last yt-dlp options reload time.

If administrator notifications are configured, **Something's broken** is available in the footer and as an icon-only header action. Both require confirmation before a manual notification is sent.

## Music Metadata

Audio Downloader performs conservative metadata enrichment at download time using only fields already supplied by yt-dlp or the queued playlist entry.

When extractor metadata provides enough album context, the fork can:

- Preserve or fill an album value from extractor-owned playlist metadata.
- Preserve track number information.
- Add a known track total when yt-dlp supplied one.
- Fall back to playlist index for track position when an album signal already exists.
- Prefer the largest known square thumbnail for music artwork.

There are no external metadata lookups and no post-download tag editor. Site-specific album guessing is deliberately avoided.

If you want library management, tag editing, or external metadata matching after download, use a dedicated tool such as beets, MusicBrainz Picard, or Lidarr.

## yt-dlp Updates

This fork has two separate yt-dlp update paths.

### Runtime container updater

`YTDL_NIGHTLY_UPDATE_TIME` defaults to `04:00` in the container's local time.

When the container starts as root, the entrypoint checks for a newer pre-release-compatible yt-dlp package before starting the application. The running app also schedules the next daily check.

When the scheduled update becomes due, Audio Downloader waits for active downloading and post-processing work to finish, exits intentionally with code `42`, and the entrypoint supervisor upgrades yt-dlp before restarting the app.

If the update service or network is unavailable, the current installed yt-dlp remains usable.

Set a different time:

```yaml
environment:
  YTDL_NIGHTLY_UPDATE_TIME: "02:30"
```

Disable runtime updating:

```yaml
environment:
  YTDL_NIGHTLY_UPDATE_TIME: ""
```

The updater writes to the system Python installation, so this update path requires the normal root entrypoint phase. If Docker's `user:` setting bypasses it, Audio Downloader still runs, but the runtime updater is disabled.

### Repository updater

The repository also has a scheduled GitHub Actions workflow that checks `uv.lock` for a newer yt-dlp version every day.

When it finds an update on `master`, it:

1. Updates the yt-dlp lockfile entry.
2. Commits the new lockfile to `master`.
3. Dispatches the normal build workflow.
4. Runs the full quality checks.
5. Publishes fresh `linux/amd64` and `linux/arm64` images to GHCR if validation succeeds.

This keeps newly built images current while the runtime updater protects already-running containers from urgent extractor breakage between image rebuilds.

## Administrator Notifications

Optional administrator notifications use Pushover from the backend only.

Configure both secrets on the server:

```yaml
environment:
  PUSHOVER_APP_TOKEN: "${PUSHOVER_APP_TOKEN}"
  PUSHOVER_USER_KEY: "${PUSHOVER_USER_KEY}"
```

Never put either value in frontend code or commit them to the repository.

When configured:

- Failed downloads can trigger automatic administrator alerts.
- Automatic failure alerts share a five-minute cooldown.
- Manual **Something's broken** reports have a separate one-minute cooldown.
- Manual reports require confirmation in the UI.
- Submitted source URLs are removed from notification text before it leaves the server.
- Notification failures are logged and never change the result of the download itself.

If either secret is missing, notifications remain disabled.

This mechanism cannot report a host or container that never started. Use an external uptime or infrastructure monitor for those failures.

## Docker

### Use the published image

Images are published as `ghcr.io/emonhoque/audio-downloader:latest` and the dated
release tag `ghcr.io/emonhoque/audio-downloader:2026.08.31`.

```yaml
services:
  audio-downloader:
    image: ghcr.io/emonhoque/audio-downloader:latest
    container_name: audio-downloader
    restart: unless-stopped
    ports:
      - "8081:8081"
    volumes:
      - /path/to/downloads:/downloads
    environment:
      PUID: "1000"
      PGID: "1000"
      YTDL_NIGHTLY_UPDATE_TIME: "04:00"
```

Then open:

```text
http://localhost:8081
```

### Build locally

```bash
docker build -t audio-downloader:local .
```

```bash
docker run -d \
  --name audio-downloader \
  --restart unless-stopped \
  -p 8081:8081 \
  -v /path/to/downloads:/downloads \
  audio-downloader:local
```

The image is built with a Node 22 frontend stage and a Python 3.13 runtime. It includes FFmpeg, yt-dlp, Deno, aria2, the BgUtils POT provider, `tini`, and `gosu`.

The container exposes port `8081`, stores state under `/downloads/.metube` by default, and includes an HTTP or HTTPS-aware health check.

## Configuration

Environment variables can be supplied through Docker Compose or `docker run -e`.

### Runtime and permissions

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` | `1000` | Runtime user ID |
| `PGID` | `1000` | Runtime group ID |
| `UMASK` | `022` | File creation mask |
| `CHOWN_DIRS` | `true` | Set to `false` to skip startup ownership changes |
| `LOGLEVEL` | `INFO` | Application log level |
| `ENABLE_ACCESSLOG` | `false` | Enable HTTP access logging |
| `DEFAULT_THEME` | `auto` | `light`, `dark`, or `auto` |

Legacy `UID` and `GID` values remain accepted by the entrypoint.

### Download behavior

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_CONCURRENT_DOWNLOADS` | `3` | Concurrent download workers |
| `DEFAULT_OPTION_PLAYLIST_ITEM_LIMIT` | `0` | Default playlist or channel item limit, with `0` meaning unlimited |
| `CLEAR_COMPLETED_AFTER` | `0` | Seconds before completed History entries are cleared |
| `DELETE_FILE_ON_TRASHCAN` | `false` | Also delete the media file when removing a completed item |
| `DEFAULT_FOLDER` | empty | Initial relative folder when custom directories are enabled |

### Storage and naming

| Variable | Docker default | Purpose |
| --- | --- | --- |
| `DOWNLOAD_DIR` | `/downloads` | Base download directory |
| `AUDIO_DOWNLOAD_DIR` | `DOWNLOAD_DIR` | Audio output directory |
| `STATE_DIR` | `/downloads/.metube` | Persistent queue, History, and inherited subscription state |
| `TEMP_DIR` | `/downloads` | Temporary and resumable download files |
| `CUSTOM_DIRS` | `true` | Enable relative per-download folders |
| `CREATE_CUSTOM_DIRS` | `true` | Allow new relative folders |
| `CUSTOM_DIRS_EXCLUDE_REGEX` | `(^|/)[.@].*$` | Filter folder suggestions |
| `DOWNLOAD_DIRS_INDEXABLE` | `false` | Enable directory indexes |

Naming templates:

```text
OUTPUT_TEMPLATE=%(title)s.%(ext)s
OUTPUT_TEMPLATE_CHAPTER=%(title)s - %(section_number)02d - %(section_title)s.%(ext)s
OUTPUT_TEMPLATE_PLAYLIST=%(playlist_title)s/%(title)s.%(ext)s
OUTPUT_TEMPLATE_CHANNEL=%(channel)s/%(title)s.%(ext)s
```

All relative output paths continue through MeTube's directory containment and path sanitization logic.

### yt-dlp options

| Variable | Default | Purpose |
| --- | --- | --- |
| `YTDL_OPTIONS` | `{}` | Global yt-dlp API options as JSON |
| `YTDL_OPTIONS_FILE` | empty | JSON options file that can be reloaded |
| `YTDL_OPTIONS_PRESETS` | `{}` | Named option bundles |
| `YTDL_OPTIONS_PRESETS_FILE` | empty | Reloadable preset file |
| `ALLOW_YTDL_OPTIONS_OVERRIDES` | `false` | Allow trusted per-download JSON overrides |
| `YTDL_NIGHTLY_UPDATE_TIME` | `04:00` | Daily runtime yt-dlp update time |
| `ALLOW_PRIVATE_ADDRESSES` | `false` | Permit private destination addresses in submitted URLs |

Example:

```yaml
environment:
  YTDL_OPTIONS: '{"proxy":"http://proxy:8080","ratelimit":5000000}'
```

`ALLOW_YTDL_OPTIONS_OVERRIDES` should only be enabled for trusted users. yt-dlp exposes options that can execute commands or otherwise change server behavior.

The fork merges configured yt-dlp layers but still enforces the mandatory audio-only selector and audio conversion rules.

### Cookies

The UI can upload a Netscape-format `cookies.txt` file from Advanced Options. Uploaded cookies are stored server-side with restricted permissions and can be removed from the same UI.

### Web server and reverse proxy

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8081` | Listen port |
| `URL_PREFIX` | empty | Serve below a reverse-proxy path prefix |
| `PUBLIC_HOST_URL` | `download/` | Public generic download-link base |
| `PUBLIC_HOST_AUDIO_URL` | `audio_download/` | Public audio download-link base |
| `HTTPS` | `false` | Enable native TLS |
| `CERTFILE` | empty | TLS certificate |
| `KEYFILE` | empty | TLS private key |
| `CORS_ALLOWED_ORIGINS` | empty | Trusted browser origins |
| `ROBOTS_TXT` | empty | Optional mounted robots.txt |

Socket.IO is used for live queue updates. Reverse proxies must support WebSocket upgrade headers.

## Compatibility and Inherited MeTube Features

The backend still contains inherited MeTube queue, state, playlist, channel, and subscription infrastructure. The current redesigned frontend is intentionally centered on direct URL downloading, active work, and History rather than exposing a separate subscription dashboard.

Existing API clients, bookmarklets, shortcuts, and older MeTube clients can continue to submit URLs. Legacy media-type fields are normalized so they cannot bypass the audio-only contract.

## Development

### Frontend

Requires Node.js 22+ and pnpm.

```bash
cd ui
pnpm install --frozen-lockfile
pnpm run lint
pnpm run build
pnpm exec ng test --watch=false
```

### Backend

Requires Python 3.13+ and uv.

Build the frontend first because backend tests import the generated static assets.

```bash
uv sync --frozen --group dev
python -m compileall app
uv run pytest app/tests/
```

### Complete image

```bash
docker build -t audio-downloader:test .
```

The main GitHub Actions workflow performs frontend linting, frontend build and tests, Python compilation, backend tests, and a Trivy filesystem scan before publishing a multi-architecture image.

## Project Scope

This fork follows the same narrow product boundary as MeTube: give it a URL, run yt-dlp correctly, and write the requested file correctly.

In scope:

- Download workflow improvements.
- yt-dlp-owned functionality exposed in the UI.
- Better use of metadata yt-dlp already provides.
- Correct metadata and artwork written during the download.
- Queue, History, playlist, channel, and inherited subscription behavior.

Out of scope:

- Post-download tag editors.
- External music metadata services.
- Media-library management.
- Reorganizing already-downloaded files.
- Site-specific metadata guessing that belongs in yt-dlp extractors.

## Upstream

Audio Downloader is based on [MeTube by alexta69 and its contributors](https://github.com/alexta69/metube).

The upstream license, architecture, and attribution are preserved. This fork intentionally changes the product contract from a general video downloader to a focused audio downloader while continuing to use MeTube and yt-dlp as the underlying download engine.
