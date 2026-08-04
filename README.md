# ArkLaTex Weather Live

24/7 broadcast page for a YouTube live weather channel covering the ArkLaTex
(NWS Shreveport county warning area — NE Texas, NW Louisiana, SW Arkansas,
SE Oklahoma). A full-screen 1920×1080 "broadcast view" runs in a headless
Chromium on a VPS; ffmpeg captures it and pushes an H.264 stream to YouTube
RTMP 24/7. See `deploy/README.md` for the streaming pipeline and
`docs/24-7-hardening.md` for how it stays alive unattended.

## Run it

```bash
npm install
npm run build-geo    # one-time: fetches SHV county/zone geometries + census population grid
npm run dev          # open http://localhost:5173/
```

- **Live mode** (default): polls `api.weather.gov` active alerts every 30 s,
  plus a couple dozen other free feeds (see Data sources below).
- **Replay mode**: `http://localhost:5173/?replay=demo-outbreak` — staged
  severe-weather scenario from `public/replay/demo-outbreak.json`, time-shifted
  to "now". Use this to develop/demo the director on quiet weather days.

Radar and rainfall color LUTs (`src/map/n0q-lut.js`, `src/map/precip-lut.js`)
are pre-generated and committed — only rerun `npm run build-radar-lut` /
`npm run build-precip-lut` if you're changing the color ramps.

## What's on screen

### Map

Grey "Pivotal-style" **vector basemap** — OpenFreeMap tiles rendered by
MapLibre GL inside Leaflet (`@maplibre/maplibre-gl-leaflet`), restyled at
runtime from the positron style (`src/map/vector-basemap.js`): grey land /
dark water, county lines, and a separate labels-only GL layer *above* the
radar with road names + highway shields that populate at warning-tour zoom.
Falls back to the old CARTO raster stack (CSS grey filter) if the style
fetch fails.

Base → SPC Day-1 categorical outlook (ambient, swapped for CPC/drought/ERO/
fire-weather/tropical ramps when one of those is on air) → **animated NEXRAD
loop** (30-min window, 7 frames, always in motion, cache re-busted every
5 min; tiles decode to true dBZ via the baked IEM lookup table, get smoothed
in data space with neighbor-tile padding, and repaint through a broadcast
palette with intensity-scaled alpha; frames crossfade — `src/map/radar-render.js`,
test with `/test-radar.html?v=lat,lon,zoom`) → white state borders → SPC
mesoscale discussions (dashed cyan) → watches (dashed) → warning polygons →
curated city/town labels (own the overview zoom band < 8.45; GL labels take
over when zoomed in).

Quiet-day map modes swap in for the ambient outlook layer when there's a
story to tell: GOES-East satellite (visible/IR/GeoColor), MRMS rainfall
totals, river gauge stages, drought monitor, excessive rainfall outlook,
fire weather outlook, CPC 6–10 & 8–14 day temp/precip outlooks, current
temps/feels-like/dew-point extremes, and wind & gusts.

### Director (`src/director/director.js`)

New warnings pre-empt the camera — fly deep into the polygon (streets
visible), show the detail card, then rotate overview ↔ warnings by severity.
A lone warning keeps most of the airtime. Named tropical systems fold into
the rotation promptly (track/cone, GOES GeoColor on the storm, basin-wide
development areas, per-disturbance follow-ups).

No warnings → tour watches (subtle flashing outline + detail card), then
radar echo clusters found by the **precip scout** (`src/data/precip-scout.js`,
"Tracking precipitation near <town>" — or "12 mi NW of <town>" when the echo
isn't actually close), heat-safety tips while a heat product is active, then
a long quiet-day rotation: SPC Day 1–3 outlooks, CPC outlooks, river gauges,
drought monitor, ERO, fire weather, satellite, rainfall totals, current
temps / feels-like / dew-point ("muggy meter") extremes, wind & gusts, and a
per-city panel sequence (almanac normals/records → frost & growing season →
UV index → AQI → pollen) that cycles through the region's climate cities,
capped by national one-offs (aurora Kp/G-scale, sun & daylight, moon phases).
The map never sits still.

### Banner

Most severe active alert with expiry countdown · brand + Central time clock ·
top-5 alert-type counts.

### Detail card

Expiry countdown, detection source, damage threat, max hail/wind,
~population in the polygon (2020 census tracts), issue time.

### Ticker (bottom)

Active alerts → SPC Day-1 risk for the region → live city observations
(KSHV/KTXK/KTYR/KGGG/KMLU/KLFK) → sunrise/sunset almanac → branding. Content
swaps at the loop seam so the scroll never jumps.

### Music + now-playing

On the VPS, mpv shuffles a folder of tracks into the stream's audio bed; a
separate banner widget (`src/ui/now-playing.js`) shows the current track
pulled from mpv's IPC socket. See `deploy/README.md` for setup and volume
control.

## Data sources (all free, no keys)

| Source | Used for |
|---|---|
| api.weather.gov `/alerts/active` | warnings, watches, advisories |
| api.weather.gov `/gridpoints` forecast + observations | city forecasts, live obs, feels-like/dew point |
| spc.noaa.gov outlook GeoJSON | Day 1–3 categorical outlooks (dev-proxied in `vite.config.js`) |
| spc.noaa.gov storm reports | tornado/wind/hail report tour stops |
| mesonet.agron.iastate.edu (IEM) | NEXRAD radar tiles · SPC MCD polygons · GOES satellite tiles · MRMS rainfall LUT source |
| NHC (nhc.noaa.gov) | active tropical cyclone track/cone, basin development areas |
| NOAA WPC | Excessive Rainfall Outlook (ERO) GeoJSON, Day1–5 |
| NOAA CPC (ArcGIS MapServer) | 6–10 day & 8–14 day temperature/precipitation outlooks |
| NOAA SWPC | Kp forecast + G-scale (aurora card) |
| U.S. Drought Monitor | drought categories |
| NWS/NIFC fire weather outlook | fire weather risk areas |
| USGS/NWS river gauges | stage, flood category, forecast |
| EPA AirNow-derived daily UV Index | UV index by ZIP |
| Open-Meteo | batched air quality index (AQI) |
| Pollen.com (IQVIA, unofficial) | tree/grass/weed pollen index |
| api.weather.gov `/offices/SHV` + zones | region definition (build script) |
| TIGERweb + census.gov | tract population grid (build script) |
| tiles.openfreemap.org | vector basemap tiles + fonts + shield sprites (free for commercial use) |
| Astronomical calculations (local) | sunrise/sunset/day length, moon phases — no external feed |

## Streaming to YouTube

See `deploy/README.md` for provisioning, operations, and the systemd unit
layout (serve / stream / watchdog), and `docs/24-7-hardening.md` for the
fetch-timeout + watchdog + staleness-chip design that keeps the stream honest
when nobody's watching, plus the YouTube-liveness watchdog that self-heals
orphaned broadcasts.

## Dev tools

- `/test-radar.html?v=lat,lon,zoom` — isolated radar-loop test harness.
- `icon-review.html` — visual index of the custom SVG icon set.
- `npm run test:visual` — Playwright visual-regression tests
  (`tests/visual-regression.spec.js`); `test:visual:update` to refresh
  snapshots after an intentional visual change.
- `STYLE_GUIDE.md` — visual identity: typography, color, icon system, and
  rules for extending them consistently.

## Later phases

Fronts/pressure centers, live traffic/skyline cams (rights research in
`docs/live-cams-research.md`), TTS callouts.
