# MeTube Audio

This repository is an audio-only fork of [MeTube](https://github.com/alexta69/metube),
a self-hosted web interface for [yt-dlp](https://github.com/yt-dlp/yt-dlp). It keeps
MeTube's queue, playlists, channels, subscriptions, persistent state, cookies,
advanced yt-dlp options, Socket.IO updates, and Docker deployment while making audio
the only supported media output.

## What This Fork Does

Paste any URL supported by yt-dlp, choose an audio format if desired, and download.
Playlist and channel URLs enqueue their individual audio items. Subscriptions poll for
new items and use the same audio settings. Retries preserve an explicit supported
audio choice; ambiguous and historical video settings become the product default.

The backend is authoritative. Old clients may still send compatibility fields such as
`download_type=video`, a video codec, resolution, caption mode, or thumbnail mode, but
those values cannot create a video, caption-only, or thumbnail-only download. They are
normalized to the default audio request.

## Default Behavior

**Downloads are saved as MP3 by default. Other supported audio formats can be selected
manually before downloading.**

Simply paste a URL and click **Download** to get MP3. This default applies independently
in the frontend and backend, including direct API requests with only a URL, playlist and
channel items, new subscriptions, retries, restored downloads, bookmarklets, and older
clients.

Format precedence is:

1. An explicit, supported audio format selected for the current download.
2. A previously saved supported audio selection in the web UI or subscription record.
3. MP3.

An unsupported explicit audio format is rejected. Obsolete or ambiguous legacy media
settings safely fall back to MP3.

## Audio Formats

The UI exposes formats supported by the existing yt-dlp/FFmpeg audio pipeline:

- **MP3** — default; 320, 192, or 128 kbps.
- **M4A** — Best, 192, or 128 kbps.
- **Opus** — Best.
- **FLAC** — Best.
- **WAV** — Best.

"Best" lets yt-dlp/FFmpeg use the selected output codec without applying a numeric
bitrate target. When the downloaded source is already compatible, yt-dlp can avoid an
unnecessary conversion; otherwise FFmpeg produces the requested format. WAV does not
embed artwork because that path is not reliably supported. Compatible formats retain
MeTube's metadata and artwork behavior.

## MP3 Quality

The default is **320 kbps**. MeTube passes `preferredquality=320` to yt-dlp's
`FFmpegExtractAudio` postprocessor, which asks FFmpeg for `-b:a 320k`. This is a target
output bitrate; it cannot restore detail absent from the source. Lower 192 and 128 kbps
settings are available intentionally in the format selector.

## Conversion Behavior

Every download uses an audio-only yt-dlp selector and the existing FFmpeg extraction
postprocessor:

```text
best available source audio -> FFmpegExtractAudio -> selected audio format
```

MP3 is intentionally the default even when a site naturally offers Opus or M4A. The
source is downloaded directly and converted once; this fork does not introduce an
extra lossy intermediate. Metadata, embedded artwork, chapter metadata, optional
chapter splitting, playlist metadata, and SponsorBlock processing remain available
where the chosen format supports them.

Global `YTDL_OPTIONS`, named presets, and per-download overrides still combine in that
order. More specific user layers may configure extractors, authentication, proxies,
rate limits, and other yt-dlp behavior. After those layers are merged, MeTube forces
the audio-only source selector, enables the media download, disables retaining the
source file, and installs the chosen FFmpeg audio conversion. Advanced options cannot
turn the application back into a normal video downloader.

## Automatic yt-dlp Updating

Automatic yt-dlp nightly updates are enabled by default at **04:00 local container
time** through the existing `YTDL_NIGHTLY_UPDATE_TIME` mechanism.

At container startup, the root entrypoint:

1. Logs the installed yt-dlp version.
2. Runs a trusted `pip` upgrade for the yt-dlp nightly-compatible package and its
   existing runtime extras.
3. Logs whether the installed version changed.
4. Continues with the installed version if the update service or network is unavailable.
5. Drops privileges before starting MeTube.

MeTube schedules the next daily check. When it becomes due, it waits for active
downloads and postprocessing to finish, requests a graceful exit with code 42, and the
entrypoint supervisor performs the upgrade before restarting MeTube. Queue and
subscription state remain persisted. There is one scheduled check per process start,
so a failed check cannot create a rapid restart loop.

Configure the schedule with a 24-hour local time:

```yaml
environment:
  YTDL_NIGHTLY_UPDATE_TIME: "02:30"
```

Disable automatic yt-dlp updates explicitly with an empty value:

```yaml
environment:
  YTDL_NIGHTLY_UPDATE_TIME: ""
```

The updater needs write access to the system Python installation, so it runs in the
root entrypoint before MeTube is launched as `PUID:PGID`. If Docker's `user:` setting
bypasses the root entrypoint phase, the entrypoint logs that automatic updating is
disabled; the application itself still runs as the configured non-root user.

Inspect versions in the startup log, with `docker exec metube-audio yt-dlp --version`,
or through the JSON endpoint at `http://localhost:8081/version`.

## Docker Usage

Build this fork locally so the image contains this audio-only UI and backend:

```bash
docker build -t metube-audio:local .
```

Run it directly:

```bash
docker run -d \
  --name metube-audio \
  --restart unless-stopped \
  -p 8081:8081 \
  -v /path/to/downloads:/downloads \
  metube-audio:local
```

Or use Docker Compose:

```yaml
services:
  metube:
    build: .
    image: metube-audio:local
    container_name: metube-audio
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

The image includes Python 3.13, yt-dlp, FFmpeg, the built Angular UI, Deno, aria2,
the existing BgUtils POT provider, `tini`, and `gosu`. It exposes port 8081, persists
downloads and state under `/downloads`, and includes the existing HTTP health check.

## Configuration

Environment variables can be supplied with `docker run -e` or Compose's
`environment:` section.

### Runtime and permissions

- `PUID`, `PGID` — user and group used for MeTube. Both default to `1000`; legacy
  `UID` and `GID` remain supported.
- `UMASK` — file-creation mask, default `022`.
- `CHOWN_DIRS` — set to `false` to skip startup ownership changes. The configured
  user must already be able to write all mounted directories.
- `LOGLEVEL` — `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`, or `NONE`; default
  `INFO`.
- `ENABLE_ACCESSLOG` — enable HTTP access logs; default `false`.
- `DEFAULT_THEME` — `light`, `dark`, or `auto`; default `auto`.

### Download behavior

- `MAX_CONCURRENT_DOWNLOADS` — concurrent workers; default `3`.
- `DEFAULT_OPTION_PLAYLIST_ITEM_LIMIT` — default playlist/channel item limit;
  `0` means unlimited.
- `CLEAR_COMPLETED_AFTER` — seconds before history items are cleared; `0` disables.
- `DELETE_FILE_ON_TRASHCAN` — also remove the media file when clearing it from the
  completed list; default `false`.
- `SUBSCRIPTION_DEFAULT_CHECK_INTERVAL` — default polling interval in minutes;
  default `60`.
- `SUBSCRIPTION_SCAN_PLAYLIST_END` — newest entries inspected per check; default `50`.
- `SUBSCRIPTION_MAX_SEEN_IDS` — maximum remembered IDs per subscription; default
  `50000`.

### Storage and naming

- `DOWNLOAD_DIR` — base media directory; `/downloads` in Docker.
- `AUDIO_DOWNLOAD_DIR` — audio output directory; defaults to `DOWNLOAD_DIR`.
- `STATE_DIR` — persistent queue, history, and subscription state; defaults to
  `/downloads/.metube` in Docker.
- `TEMP_DIR` — intermediate files; defaults to `/downloads` in Docker. Using volatile
  storage can prevent resuming an interrupted download.
- `CUSTOM_DIRS` — enable the per-download folder field; default `true`.
- `CREATE_CUSTOM_DIRS` — allow creating relative subdirectories; default `true`.
- `CUSTOM_DIRS_EXCLUDE_REGEX` — filters folder suggestions; default
  `(^|/)[.@].*$`.
- `DEFAULT_FOLDER` — initial relative folder selection when custom directories are
  enabled.
- `DOWNLOAD_DIRS_INDEXABLE` — expose directory indexes; default `false`.
- `OUTPUT_TEMPLATE` — default `%(title)s.%(ext)s`.
- `OUTPUT_TEMPLATE_CHAPTER` — default
  `%(title)s - %(section_number)s %(section_title)s.%(ext)s`.
- `OUTPUT_TEMPLATE_PLAYLIST` — default
  `%(playlist_title)s/%(title)s.%(ext)s`.
- `OUTPUT_TEMPLATE_CHANNEL` — default `%(channel)s/%(title)s.%(ext)s`.

Paths derived from URLs or extractor metadata continue through MeTube's directory
containment and path-component sanitization. Old video records remain readable for
history, but any new queue item derived from them is stored under the audio directory.

### yt-dlp, authentication, and networking

- `YTDL_OPTIONS` — global yt-dlp API options as a JSON object.
- `YTDL_OPTIONS_FILE` — JSON options file, reloaded when it changes.
- `YTDL_OPTIONS_PRESETS` — named JSON option bundles shown in Advanced Options.
- `YTDL_OPTIONS_PRESETS_FILE` — reloadable presets file.
- `ALLOW_YTDL_OPTIONS_OVERRIDES` — expose per-download free-form JSON options;
  default `false`. This should only be enabled for trusted users because yt-dlp has
  options capable of executing commands.
- `YTDL_NIGHTLY_UPDATE_TIME` — daily update time in `HH:MM`; default `04:00`;
  empty disables.
- `ALLOW_PRIVATE_ADDRESSES` — disable SSRF address restrictions; default `false`.
  Enable only in a trusted network environment.

The UI can upload a Netscape-format `cookies.txt` file under Advanced Options. Uploaded
cookies are stored with owner-only permissions and can be deleted from the same UI.
Proxy, extractor, authentication, and cookie-file settings in `YTDL_OPTIONS` remain
supported.

Example global options:

```yaml
environment:
  YTDL_OPTIONS: '{"proxy":"http://proxy:8080","ratelimit":5000000}'
```

Presets and overrides are layered over global options, but the fork's mandatory audio
selector and conversion settings win where required to preserve the audio-only
contract.

### Web server

- `HOST` — bind address; Docker defaults to `0.0.0.0`. Use `*` or empty for both
  address families.
- `PORT` — default `8081`.
- `URL_PREFIX` — serve under a path prefix when using a reverse proxy.
- `PUBLIC_HOST_URL`, `PUBLIC_HOST_AUDIO_URL` — public download-link bases.
- `HTTPS`, `CERTFILE`, `KEYFILE` — native TLS settings.
- `CORS_ALLOWED_ORIGINS` — comma-separated trusted origins for extensions and
  bookmarklets. `*` never grants credentialed CORS requests.
- `ROBOTS_TXT` — path to a mounted `robots.txt`.

MeTube uses WebSocket connections for live queue updates. A reverse proxy must pass
the `Upgrade` and `Connection` headers.

## Sending Links to MeTube

Existing MeTube browser extensions, bookmarklets, iOS shortcuts, and API clients can
still submit URLs. Older clients may send the retired media fields; the backend
normalizes them to MP3 audio. Configure `CORS_ALLOWED_ORIGINS` for browser-originated
requests, and use HTTPS when the source page is HTTPS.

## Development and Testing

The supported local toolchain is Node.js 22+, pnpm, Python 3.13+, and uv. Build the UI
before backend tests because the server imports the generated static assets.

```bash
cd ui
pnpm install --frozen-lockfile
pnpm run lint
pnpm run build
pnpm exec ng test --watch=false

cd ..
uv sync --frozen --group dev
python -m compileall app
uv run pytest app/tests/
```

Build the complete deployment image with:

```bash
docker build -t metube-audio:test .
```

## Upstream

This project is based on [MeTube by alexta69 and its contributors](https://github.com/alexta69/metube).
It preserves the upstream license, architecture, security model, and attribution. The
fork-specific product contract is deliberately narrow: give MeTube a supported URL and
write the requested audio file correctly. Post-download tag editing, external metadata
lookups, and library organization remain jobs for tools such as beets, MusicBrainz
Picard, or Lidarr.
