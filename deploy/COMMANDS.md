# VPS Operations Cheat Sheet

Quick reference for managing the live ArkLaTex Weather stream on the Contabo
VPS. For the full setup story see `deploy/README.md`; this file is just the
commands you'll actually run day to day.

**Host:** `ssh arklatex-contabo` (alias in `~/.ssh/config` → 217.77.12.16,
key `id_ed25519_arklatex`). Repo lives at `/opt/arklatex`; commands below
assume you're either SSH'd in or running them via `ssh arklatex-contabo '...'`.

```
arklatex-serve.service     node deploy/serve.js (dist + SPC proxy :8080)
arklatex-stream.service    deploy/stream.sh = Xvfb -> Chromium -> ffmpeg -> RTMP
arklatex-watchdog.timer    deploy/watchdog.sh every 2 min (frozen-frame check)
```

---

## 1. Push a code update (the common case)

Local: commit + push to `main` as usual. Then rebuild and restart on the VPS:

```bash
ssh arklatex-contabo 'cd /opt/arklatex && git pull --ff-only && npm ci && npm run build && systemctl restart arklatex-stream'
```

- `serve.js` reads `dist/` per request — no restart needed for that part.
- Restarting `arklatex-stream` just reloads Chromium; expect a **~15s blip**
  on the live YouTube feed.
- `deploy/stream.sh` and `deploy/watchdog.sh` must stay executable
  (`100755`) — systemd's `ExecStart` runs them directly. `git pull` normally
  preserves the bit, but if a restart fails, check `ls -l deploy/*.sh`.

If you only touched `deploy/serve.js` or the systemd unit files, restart the
relevant unit instead of (or in addition to) the stream:

```bash
ssh arklatex-contabo 'systemctl restart arklatex-serve'
```

## 2. Check status

```bash
ssh arklatex-contabo 'systemctl status arklatex-serve arklatex-stream arklatex-watchdog.timer'
```

```bash
# live ffmpeg speed should hold ~1x
ssh arklatex-contabo 'journalctl -u arklatex-stream -f'

# page serving OK
ssh arklatex-contabo "curl -s localhost:8080/ | head -3"
```

## 3. See what's actually on screen

```bash
ssh arklatex-contabo 'ffmpeg -f x11grab -video_size 1920x1080 -i :99 -frames:v 1 /tmp/frame.png'
scp arklatex-contabo:/tmp/frame.png .
```

## 4. Watchdog

Restarts the stream chain if frames stop changing (checks every 2 min via
the timer). Dry-run it manually any time:

```bash
ssh arklatex-contabo 'bash /opt/arklatex/deploy/watchdog.sh'
```

Running it twice in a row on a healthy stream must **not** trigger a
restart (the clock overlay ticks, so frame hashes differ — that's expected
and fine).

## 5. Config changes (`/etc/arklatex.env`)

```bash
ssh arklatex-contabo 'nano /etc/arklatex.env'
ssh arklatex-contabo 'systemctl restart arklatex-stream'
```

Common edits:
- `YOUTUBE_STREAM_KEY` — rotate if leaked/changed in YouTube Studio.
- `MUSIC_VOLUME` — linear gain, default `0.4` (`1.0` = file's native level).
  There's no OBS-style fader on the VPS, so this + restart is the whole
  workflow.
- `MUSIC_FILE` — path under `/var/lib/arklatex/music/`.

## 6. Restart everything from scratch

```bash
ssh arklatex-contabo 'systemctl restart arklatex-serve arklatex-stream'
```

Any stage dying exits the whole `arklatex-stream` unit; systemd restarts it
after 10s. The page rebuilds all state from live APIs on load, so a full
restart is always safe — just another ~15s blip.

## 7. Performance / CPU pinning

No GPU on this box — the map renders via SwiftShader (software WebGL), so
camera moves are the expensive part. Chromium is pinned to cores 0-4,
ffmpeg to 5-7 in `stream.sh`. Verify pinning is actually in effect:

```bash
ssh arklatex-contabo 'taskset -cp $(pgrep -f chromium | head -1)'
ssh arklatex-contabo 'taskset -cp $(pgrep ffmpeg | head -1)'
```

`htop` is useful for a quick eyeball of load per core during a live camera
move.

## 8. Logs

```bash
ssh arklatex-contabo 'journalctl -u arklatex-stream -n 200 --no-pager'
ssh arklatex-contabo 'journalctl -u arklatex-serve -n 200 --no-pager'
ssh arklatex-contabo 'journalctl -u arklatex-watchdog -n 50 --no-pager'
```

## 9. 12-hour archive cap

A continuous stream isn't archived past 12h by YouTube. If VODs matter,
add a nightly timer (~4am CT) that restarts `arklatex-stream` — same ~15s
blip, but YouTube rolls a fresh archive.

---

### Quick reference table

| Task                          | Command (run on VPS or via `ssh arklatex-contabo '...'`) |
|--------------------------------|------------------------------------------------------------|
| Deploy new code                | `cd /opt/arklatex && git pull --ff-only && npm ci && npm run build && systemctl restart arklatex-stream` |
| Status                         | `systemctl status arklatex-serve arklatex-stream arklatex-watchdog.timer` |
| Stream logs (live)             | `journalctl -u arklatex-stream -f` |
| Restart stream only            | `systemctl restart arklatex-stream` |
| Restart page server            | `systemctl restart arklatex-serve` |
| Dry-run watchdog                | `bash /opt/arklatex/deploy/watchdog.sh` |
| Grab current frame             | `ffmpeg -f x11grab -video_size 1920x1080 -i :99 -frames:v 1 /tmp/frame.png` |
| Edit stream key / music volume | `nano /etc/arklatex.env` then `systemctl restart arklatex-stream` |
| Check CPU pinning               | `taskset -cp $(pgrep -f chromium\|head -1)` |
