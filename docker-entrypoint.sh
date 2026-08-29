#!/bin/sh

PUID="${UID:-$PUID}"
PGID="${GID:-$PGID}"
AUDIO_DOWNLOAD_DIR="${AUDIO_DOWNLOAD_DIR:-$DOWNLOAD_DIR}"
YTDL_NIGHTLY_UPDATE_TIME="${YTDL_NIGHTLY_UPDATE_TIME-04:00}"
export YTDL_NIGHTLY_UPDATE_TIME

echo "Setting umask to ${UMASK}"
umask ${UMASK}
echo "Creating download directory (${DOWNLOAD_DIR}), audio download directory (${AUDIO_DOWNLOAD_DIR}), state directory (${STATE_DIR}), and temp dir (${TEMP_DIR})"
mkdir -p "${DOWNLOAD_DIR}" "${AUDIO_DOWNLOAD_DIR}" "${STATE_DIR}" "${TEMP_DIR}"

do_upgrade() {
    before_version="$(python3 -c 'from yt_dlp.version import __version__; print(__version__)' 2>/dev/null || echo unknown)"
    echo "Starting yt-dlp nightly update check (installed: ${before_version})"
    if ! python3 -m pip --version >/dev/null 2>&1; then
        echo "pip not found; attempting ensurepip"
        python3 -m ensurepip --upgrade >/dev/null 2>&1 || true
    fi
    if ! python3 -m pip install -U --pre "yt-dlp[default,curl-cffi,deno]"; then
        echo "Warning: yt-dlp nightly upgrade failed; continuing with existing installation"
        return 1
    fi
    after_version="$(python3 -c 'from yt_dlp.version import __version__; print(__version__)' 2>/dev/null || echo unknown)"
    if [ "${before_version}" = "${after_version}" ]; then
        echo "yt-dlp nightly is already current (${after_version})"
    else
        echo "yt-dlp nightly updated: ${before_version} -> ${after_version}"
    fi
    return 0
}

run_supervised() {
    while true; do
        "$@" &
        child_pid=$!
        trap 'kill -TERM "$child_pid" 2>/dev/null; wait "$child_pid" 2>/dev/null' TERM INT
        wait "$child_pid"
        exit_code=$?
        trap - TERM INT
        if [ "$exit_code" -eq 42 ]; then
            echo "MeTube requested yt-dlp update restart (exit 42)"
            do_upgrade || true
            continue
        fi
        return "$exit_code"
    done
}

nightly_enabled() {
    [ -n "${YTDL_NIGHTLY_UPDATE_TIME}" ]
}

disable_nightly_for_non_root() {
    if nightly_enabled; then
        echo "YTDL_NIGHTLY_UPDATE_TIME is set but this container runs as a non-root user; nightly yt-dlp updates are not supported. Ignoring YTDL_NIGHTLY_UPDATE_TIME."
        YTDL_NIGHTLY_UPDATE_TIME=""
        export YTDL_NIGHTLY_UPDATE_TIME
    fi
}

echo "Installed yt-dlp version: $(python3 -c 'from yt_dlp.version import __version__; print(__version__)' 2>/dev/null || echo unknown)"

if [ `id -u` -eq 0 ] && [ `id -g` -eq 0 ]; then
    if [ "${PUID}" -eq 0 ]; then
        echo "Warning: it is not recommended to run as root user, please check your setting of the PUID/PGID (or legacy UID/GID) environment variables"
    fi
    if [ "${CHOWN_DIRS:-true}" != "false" ]; then
        echo "Changing ownership of download and state directories to ${PUID}:${PGID}"
        chown -R "${PUID}":"${PGID}" /app "${DOWNLOAD_DIR}" "${AUDIO_DOWNLOAD_DIR}" "${STATE_DIR}" "${TEMP_DIR}"
    fi
    if nightly_enabled; then
        echo "YTDL_NIGHTLY_UPDATE_TIME is set to ${YTDL_NIGHTLY_UPDATE_TIME}; upgrading yt-dlp on startup"
        do_upgrade || true
    fi
    echo "Starting BgUtils POT Provider"
    gosu "${PUID}":"${PGID}" bgutil-pot server >/tmp/bgutil-pot.log 2>&1 &
    echo "Running MeTube as user ${PUID}:${PGID}"
    run_supervised gosu "${PUID}":"${PGID}" python3 app/main.py
    exit $?
else
    echo "User set by docker; running MeTube as `id -u`:`id -g`"
    disable_nightly_for_non_root
    echo "Starting BgUtils POT Provider"
    bgutil-pot server >/tmp/bgutil-pot.log 2>&1 &
    run_supervised python3 app/main.py
    exit $?
fi
