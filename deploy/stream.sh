#!/usr/bin/env bash
# The broadcast pipeline: virtual display → Chromium kiosk rendering the
# page → ffmpeg screen-grab + shuffled music bed → YouTube RTMP. Music is no
# longer a single looped file: mpv shuffles a whole folder into a private
# PulseAudio sink and ffmpeg reads that sink's monitor. mpv also writes the
# current track title to NOWPLAYING_FILE, which serve.js surfaces to the
# banner's now-playing widget (the visualizer lives in the page now, so the
# screen-grab captures it for free — no ffmpeg filtergraph needed).
# Invoked by arklatex-stream.service; if ANY stage dies the script exits and
# systemd restarts the whole chain (state is only ever in the page, which
# rebuilds itself from live APIs in seconds).
#
# Required env (from /etc/arklatex.env):
#   YOUTUBE_STREAM_KEY  from studio.youtube.com → Go Live → Stream settings
# Optional env:
#   MUSIC_DIR           folder of royalty-free tracks to shuffle
#                        (mp3/m4a/ogg/flac). Default /var/lib/arklatex/music.
#                        Add/remove files any time — mpv reshuffles on each
#                        loop, no stream restart needed.
#   MUSIC_VOLUME        linear gain multiplier for the music bed (default 0.4,
#                        i.e. -8 dB) — OBS's volume slider has no equivalent
#                        here, so this is that control. 1.0 = file's native
#                        level, 0.5 = half as loud. Edit + `systemctl restart
#                        arklatex-stream` to retune, no rebuild needed.
set -euo pipefail

DISPLAY_NUM=:99
SIZE=1920x1080
FPS=30
# The VPS flag selects the lower-cost radar output path; local/dev rendering
# keeps the 2× supersampled tiles for visual review.
PAGE_URL="http://127.0.0.1:8080/?vps"
RTMP="rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY:?set in /etc/arklatex.env}"
: "${MUSIC_DIR:=/var/lib/arklatex/music}"
: "${MUSIC_VOLUME:=0.4}"
# Where mpv writes the current track title; serve.js reads the same path.
: "${NOWPLAYING_FILE:=/var/lib/arklatex/music/.nowplaying}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT

Xvfb "$DISPLAY_NUM" -screen 0 "${SIZE}x24" -nolisten tcp &

sleep 2

# CPU affinity: the software renderer (SwiftShader, no GPU here) and the x264
# encoder both spike at the SAME instant — every camera fly. Left to the
# scheduler they preempt each other mid-flight, and that thrash is what makes
# zooms stutter. Give Chromium the low cores and ffmpeg its own top cores so
# the encoder can never steal cycles from a half-rendered map frame.
# Split scales with the box: ffmpeg gets ~3/8 of cores (x264 ultrafast 1080p30
# wants ~3), Chromium gets the rest. Skipped on <4 cores or if taskset is
# missing — then it just runs unpinned as before.
CPU_PIN_CHROME=()
CPU_PIN_FFMPEG=()
NCORES=$(nproc 2>/dev/null || echo 1)
if command -v taskset >/dev/null 2>&1 && [ "$NCORES" -ge 4 ]; then
  FF=$(( (NCORES * 3 + 4) / 8 ))          # round(NCORES * 3/8)
  [ "$FF" -lt 1 ] && FF=1
  [ "$FF" -gt $((NCORES - 1)) ] && FF=$((NCORES - 1))
  CHROME_LAST=$((NCORES - FF - 1))
  FF_FIRST=$((NCORES - FF))
  FF_LAST=$((NCORES - 1))
  CPU_PIN_CHROME=(taskset -c "0-${CHROME_LAST}")
  CPU_PIN_FFMPEG=(taskset -c "${FF_FIRST}-${FF_LAST}")
  echo "[stream] ${NCORES} cores: chromium -> 0-${CHROME_LAST}, ffmpeg -> ${FF_FIRST}-${FF_LAST}"
fi

# --enable-unsafe-swiftshader: the vector basemap needs WebGL, and there is
# no GPU on the VPS — SwiftShader renders it in software (Chromium ≥128
# requires the explicit opt-in flag).
# --in-process-gpu: folds the GPU process into the browser process, cutting
# an IPC/sync hop off every frame — noticeably smoother map flyTo/zoom under
# software rendering, at the cost of a GPU crash taking down the whole thing
# (already systemd-restarted either way, so no real downside here).
# --disable-gpu-compositing: even plain CSS transforms (the ticker) were
# choppy, meaning the whole page's compositor — not just the WebGL map —
# was routing through SwiftShader. This forces ordinary 2D layers onto the
# CPU/Skia compositor instead; the map canvas still gets SwiftShader for
# WebGL specifically.
# --disable-gpu-vsync: Xvfb has no real display refresh to pace against —
# don't throttle frame production to a vsync signal that doesn't exist.
DISPLAY=$DISPLAY_NUM "${CPU_PIN_CHROME[@]}" chromium \
  --kiosk "$PAGE_URL" \
  --window-size=1920,1080 --window-position=0,0 \
  --enable-unsafe-swiftshader \
  --in-process-gpu \
  --disable-gpu-compositing \
  --disable-gpu-vsync \
  --autoplay-policy=no-user-gesture-required \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --noerrdialogs --disable-infobars --hide-scrollbars \
  --disable-dev-shm-usage \
  --force-device-scale-factor=1 \
  --no-first-run --disable-session-crashed-bubble \
  &

sleep 8  # let the page boot before frames start flowing

# ── Music: a private PulseAudio sink fed by a shuffled mpv playlist ──────
# A throwaway PulseAudio instance (no system session needed) exposes one
# null sink; mpv decodes the whole folder into it, shuffled and looping
# forever; ffmpeg taps the sink's monitor. Decoupling playback from the
# encoder is what buys gapless shuffle, reshuffle-per-loop, and a live-
# editable folder — none of which -stream_loop on a single file could do.
export XDG_RUNTIME_DIR=/tmp/arklatex-pulse
mkdir -p "$XDG_RUNTIME_DIR"
pulseaudio -n --exit-idle-time=-1 \
  --load="module-native-protocol-unix auth-anonymous=1" \
  --load="module-null-sink sink_name=music sink_properties=device.description=music" &
sleep 2  # let the sound server bind its socket

shopt -s nullglob
MUSIC=("$MUSIC_DIR"/*.mp3 "$MUSIC_DIR"/*.m4a "$MUSIC_DIR"/*.ogg "$MUSIC_DIR"/*.flac)
shopt -u nullglob
if [ ${#MUSIC[@]} -eq 0 ]; then
  echo "[stream] no audio files in $MUSIC_DIR" >&2
  exit 1
fi
echo "[stream] shuffling ${#MUSIC[@]} tracks from $MUSIC_DIR"
export NOWPLAYING_FILE
mpv --no-video --no-terminal --really-quiet \
  --shuffle --loop-playlist=inf \
  --audio-device=pulse/music \
  --script="$SCRIPT_DIR/nowplaying.lua" \
  "${MUSIC[@]}" &

# 6 Mbps x264, 2-second keyframes (YouTube's ask). Video is the raw screen
# grab (the banner visualizer is part of the page); audio is the mpv sink
# monitor with MUSIC_VOLUME applied.
# thread_queue_size: with two live inputs (screen + audio), a CPU spike on a
# camera fly can back up an input queue; the default (8) is too small and drops
# frames / drifts A/V. Give both inputs generous buffers.
"${CPU_PIN_FFMPEG[@]}" ffmpeg -loglevel warning \
  -f x11grab -thread_queue_size 1024 -framerate "$FPS" -video_size "$SIZE" -draw_mouse 0 -i "$DISPLAY_NUM" \
  -f pulse -thread_queue_size 1024 -i music.monitor \
  -map 0:v -map 1:a \
  -af "volume=${MUSIC_VOLUME}" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -b:v 6000k -maxrate 6000k -bufsize 12M -g $((FPS * 2)) \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  -f flv "$RTMP" &

# If Xvfb, Chromium, or ffmpeg exits, take the whole unit down with it.
wait -n
exit 1
