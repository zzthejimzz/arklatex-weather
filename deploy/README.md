# Phase 2 — streaming the broadcast page to YouTube

The page renders in a headless Chromium on a virtual display; ffmpeg grabs
that display at 30 fps, mixes a looping music track, and pushes 6 Mbps H.264
to YouTube's RTMP ingest. systemd keeps every stage alive; a watchdog
restarts the chain if frames ever stop changing.

```
VPS ── arklatex-serve.service   node deploy/serve.js (dist + SPC proxy :8080)
   ├── arklatex-stream.service  deploy/stream.sh = Xvfb → Chromium → ffmpeg → RTMP
   └── arklatex-watchdog.timer  deploy/watchdog.sh every 2 min (frozen-frame check)
```

## 0. Prerequisites (things only you can do)

- **YouTube**: channel verified for live streaming — activation takes ~24 h
  the first time (studio.youtube.com → Create → Go live). Grab the **stream
  key** from Stream settings. Set the stream to *Not made for kids*, disable
  DVR if you like, and note archives cap at 12 hours.
- **Music**: one long royalty-free loop (mp3), e.g. from the YouTube Audio
  Library — pick tracks marked safe for monetization and keep a note of the
  license. Content-ID-claimed music will strike a 24/7 stream fast.
- **VPS**: Hetzner **CPX41** (8 vCPU, ~€29/mo), **Debian 12** image. CPX31
  may work, but WebGL runs in software (SwiftShader) and x264 wants ~3 cores
  by itself — start big, downsize after watching `htop` for a day.
  Bandwidth: 6 Mbps ≈ 2 TB/mo; Hetzner includes 20 TB.

## 1. Provision

```bash
ssh root@<vps>
git clone https://github.com/zzthejimzz/arklatex-weather.git /opt/arklatex
bash /opt/arklatex/deploy/setup.sh
```

Then:

```bash
nano /etc/arklatex.env        # paste YOUTUBE_STREAM_KEY, set MUSIC_FILE
# scp your music loop to /var/lib/arklatex/music/loop.mp3
systemctl start arklatex-serve arklatex-stream arklatex-watchdog.timer
```

YouTube Studio should show "receiving" within ~30 s; go live from there
(or enable auto-start on the stream settings).

## 2. Verify

```bash
systemctl status arklatex-serve arklatex-stream   # both active
journalctl -u arklatex-stream -f                  # ffmpeg speed= should hold ~1x
curl -s localhost:8080/ | head -3                 # page served
curl -s 'localhost:8080/proxy.php?url=https%3A%2F%2Fwww.spc.noaa.gov%2Fproducts%2Foutlook%2Fday1otlk_cat.lyr.geojson' | head -c 80
# grab a frame to eyeball what's actually on the virtual display:
ffmpeg -f x11grab -video_size 1920x1080 -i :99 -frames:v 1 /tmp/frame.png
```

The watchdog can be dry-run any time: `bash /opt/arklatex/deploy/watchdog.sh`
(twice in a row on a healthy stream must NOT restart anything — the clock
ticks, so hashes differ).

## 3. Operations

- **Update the page**: `cd /opt/arklatex && git pull && npm ci && npm run
  build && systemctl restart arklatex-stream` (serve.js reads dist/ per
  request — the stream restart is just to reload Chromium).
- **Rotate the stream key**: edit `/etc/arklatex.env`, restart the stream unit.
- **12-hour archive cap**: a continuous stream simply isn't archived past
  12 h. If you want VODs, add a timer that restarts `arklatex-stream`
  nightly at ~4 am CT — a ~15 s blip while YouTube rolls a new archive.
- **Crash behavior**: any stage dying exits the whole unit → systemd
  restarts in 10 s; the page rebuilds all state from live APIs on load.

## Not in this phase

Live traffic/skyline cams (rights research tracked separately), fronts,
TTS callouts, ticker now-playing. The page itself needs no changes for any
of these to slot in later.
