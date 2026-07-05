---
name: verify
description: How to run and drive ArkLaTex Weather Live to verify changes end-to-end (dev server + headless Chrome via puppeteer-core).
---

# Verifying ArkLaTex Weather Live

The surface is a 1920×1080 broadcast page rendered in a browser — verify by
driving a real browser and screenshotting, never by importing modules.

## Launch

- `npm run dev` (background). Vite prints the port — usually 5173, but it
  falls back to 5174+ if Jim already has a dev server up. **Parse the port
  from the output; don't assume.**
- No test framework in this repo. `npx vite build` is a syntax/import check
  only, not verification.

## Drive

- `npm i puppeteer-core` in the session scratchpad (NOT the repo — it will
  dirty package.json; `cd` there explicitly and confirm with `Test-Path`).
- Chrome lives at `C:\Program Files\Google\Chrome\Application\chrome.exe`
  (Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`).
- Launch headless with `defaultViewport: { width: 1920, height: 1080 }` and
  `--disable-background-timer-throttling` (the app is timer-driven).
- Capture `page.on('console')` — the app logs failures as `[alerts]`,
  `[watchdog]`, `[soak]`, etc. A maplibre warning "Expected value to be of
  type number, but found null" is pre-existing basemap noise; a favicon 404
  is noise too.

## Useful entry points

- `/` — live mode. Give it ~20 s after load for first polls + radar tiles.
- `/?replay=demo-outbreak` — staged outbreak (~94 min script).
- `/?replay=loop-smoke&loop` — two warnings, wraps every ~70 s; fastest way
  to see issue → expiry → re-issue churn.
- `/?soak` — logs one JSON memory sample per minute; `window.__soak` array.
- `/?cam=lat,lon,zoom`, `/?lsr`, `/?mcd`, `/?panel` — dev park modes.

## Inspection hooks

- `window.__health()` — per-feed freshness (lastAttempt/lastOk) from the
  health registry. First check when something looks dead.
- Chip state: `document.getElementById('mode-chip')` innerText + className
  (`stale` class when data is old).
- Banner/popup: `#banner` innerText, `#popup-root .warn-card` presence —
  good signals for "is an alert on air" when sampling a timeline.

## Probes that work

- **Staleness/watchdog**: shift the page clock —
  `Date.now = () => realNow() + 6*60*1000` — the chip goes amber within one
  5 s tick, and the watchdog usually reloads the page within 30 s (races the
  real 30 s alert poll resetting the beat; either observation is valid).
  Watchdog reload sets localStorage `wx-watchdog-reload-at`.
- **Replay wrap**: sample `#banner` every 5 s for ~100 s on
  `?replay=loop-smoke&loop` — alerts end near t≈60 s and reappear ≈70 s.
