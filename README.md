# ArkLaTex Weather Live

24/7 broadcast page for a YouTube live weather channel covering the ArkLaTex
(NWS Shreveport county warning area — NE Texas, NW Louisiana, SW Arkansas,
SE Oklahoma). Phase 1: the full-screen 1920×1080 "broadcast view" that a
headless browser + encoder will eventually capture and push to YouTube RTMP.

## Run it

```bash
npm install
npm run build-geo    # one-time: fetches SHV county/zone geometries + census population grid
npm run dev          # open http://localhost:5173/
```

- **Live mode** (default): polls `api.weather.gov` active alerts every 30 s.
- **Replay mode**: `http://localhost:5173/?replay=demo-outbreak` — staged
  severe-weather scenario from `public/replay/demo-outbreak.json`, time-shifted
  to "now". Use this to develop/demo the director on quiet weather days.

## What's on screen

- **Map**: grey "Pivotal-style" **vector basemap** — OpenFreeMap tiles rendered
  by MapLibre GL inside Leaflet (`@maplibre/maplibre-gl-leaflet`), restyled at
  runtime from the positron style (`src/map/vector-basemap.js`): grey land /
  dark water, county lines, and a separate labels-only GL layer *above* the
  radar with road names + highway shields that populate at warning-tour zoom.
  Falls back to the old CARTO raster stack (CSS grey filter) if the style
  fetch fails. Stack: base → SPC Day-1 categorical outlook (ambient) →
  **animated NEXRAD loop** (30-min window, 7 frames, always in motion, cache
  re-busted every 5 min) → white state borders → SPC mesoscale discussions
  (dashed cyan, via IEM) → watches (dashed) → warning polygons → curated
  city/town labels (own the overview zoom band < 8.45; GL labels take over
  when zoomed in).
- **Director** (`src/director/director.js`): new warnings pre-empt the camera —
  fly deep into the polygon (streets visible), show the detail card, then
  rotate overview ↔ warnings by severity. A lone warning keeps most of the
  airtime. No warnings → tour watches (subtle flashing outline + detail card),
  then radar echo clusters found by the **precip scout**
  (`src/data/precip-scout.js`, "Tracking precipitation near <town>"), then SPC
  Day 1–3 outlooks framed wide. The map never sits still.
- **Banner**: most severe active alert with expiry countdown · brand + Central
  time clock · top-5 alert-type counts.
- **Detail card**: expiry countdown, detection source, damage threat, max
  hail/wind, ~population in the polygon (2020 census tracts), issue time.
- **Ticker** (bottom): active alerts → SPC Day-1 risk for the region → live
  city observations (KSHV/KTXK/KTYR/KGGG/KMLU/KLFK) → branding. Content swaps
  at the loop seam so the scroll never jumps. (Phase 4: now-playing music.)

## Data sources (all free, no keys)

| Source | Used for |
|---|---|
| api.weather.gov `/alerts/active` | warnings, watches, advisories |
| spc.noaa.gov outlook GeoJSON | Day 1–3 categorical outlooks (dev-proxied in `vite.config.js`) |
| mesonet.agron.iastate.edu | NEXRAD radar tiles · SPC MCD polygons (`/api/1/nws/spc_mcd.geojson`) |
| api.weather.gov `/offices/SHV` + zones | region definition (build script) |
| TIGERweb + census.gov | tract population grid (build script) |
| tiles.openfreemap.org | vector basemap tiles + fonts + shield sprites (free for commercial use) |

## Later phases (see plan)

Streaming pipeline (VPS + Xvfb + Chromium + ffmpeg → YouTube RTMP), audio loop,
watchdogs/hardening, then fronts/pressure centers, live cams, TTS callouts.
(Basemap licensing is resolved: OpenFreeMap is free for commercial use; CARTO
raster remains only as an emergency fallback.)
