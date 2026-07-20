#!/usr/bin/env bash
# Frozen-frame watchdog, run every 2 minutes by arklatex-watchdog.timer.
# The page is never visually still (radar loop, ticker, clock), so two
# consecutive identical screen grabs mean the renderer is wedged even though
# every process looks alive — the failure mode systemd's Restart= can't see.
set -euo pipefail

DISPLAY_NUM=:99
STATE=/run/arklatex-watchdog.hash

grab_hash() {
  ffmpeg -loglevel error -f x11grab -video_size 1920x1080 -i "$DISPLAY_NUM" \
    -frames:v 1 -f image2pipe -vcodec ppm - 2>/dev/null | md5sum | cut -d' ' -f1
}

current=$(grab_hash || echo "grab-failed")
previous=$(cat "$STATE" 2>/dev/null || echo "none")
echo "$current" > "$STATE"

if [[ "$current" == "$previous" ]]; then
  echo "watchdog: frame unchanged since last check ($current) — restarting stream"
  rm -f "$STATE"
  systemctl restart arklatex-stream.service
fi
