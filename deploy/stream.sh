#!/usr/bin/env bash
# The broadcast pipeline: virtual display → Chromium kiosk rendering the
# page → ffmpeg screen-grab + looping music → YouTube RTMP.
# Invoked by arklatex-stream.service; if ANY stage dies the script exits and
# systemd restarts the whole chain (state is only ever in the page, which
# rebuilds itself from live APIs in seconds).
#
# Required env (from /etc/arklatex.env):
#   YOUTUBE_STREAM_KEY  from studio.youtube.com → Go Live → Stream settings
#   MUSIC_FILE          absolute path to the royalty-free loop (mp3/m4a)
set -euo pipefail

DISPLAY_NUM=:99
SIZE=1920x1080
FPS=30
PAGE_URL="http://127.0.0.1:8080/"
RTMP="rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY:?set in /etc/arklatex.env}"
: "${MUSIC_FILE:?set in /etc/arklatex.env}"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT

Xvfb "$DISPLAY_NUM" -screen 0 "${SIZE}x24" -nolisten tcp &

sleep 2

# --enable-unsafe-swiftshader: the vector basemap needs WebGL, and there is
# no GPU on the VPS — SwiftShader renders it in software (Chromium ≥128
# requires the explicit opt-in flag).
DISPLAY=$DISPLAY_NUM chromium \
  --kiosk "$PAGE_URL" \
  --window-size=1920,1080 --window-position=0,0 \
  --enable-unsafe-swiftshader \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs --disable-infobars --hide-scrollbars \
  --disable-dev-shm-usage \
  --force-device-scale-factor=1 \
  --no-first-run --disable-session-crashed-bubble \
  &

sleep 8  # let the page boot before frames start flowing

# 6 Mbps x264, 2-second keyframes (YouTube's ask), music loops forever.
ffmpeg -loglevel warning \
  -f x11grab -framerate "$FPS" -video_size "$SIZE" -i "$DISPLAY_NUM" \
  -stream_loop -1 -i "$MUSIC_FILE" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -b:v 6000k -maxrate 6000k -bufsize 12M -g $((FPS * 2)) \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  -f flv "$RTMP" &

# If Xvfb, Chromium, or ffmpeg exits, take the whole unit down with it.
wait -n
exit 1
