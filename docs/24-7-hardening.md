# 24/7 Hardening

What keeps the stream honest and alive when nobody is watching it. Three
layers: root-cause fixes (fetch timeouts), self-recovery (watchdog), and
honest display (staleness chip). Plus the soak-test procedure.

## Root cause: fetch timeouts (`src/utils/net.js`)

Every polling loop (alerts, reports, MCDs, forecasts, ticker obs, SPC
outlooks) reschedules its next poll in `finally`. A plain `fetch()` can hang
forever on a dead connection — which would silently kill that loop for good.
All data fetches now go through `fetchWithTimeout` (30 s AbortController), so
the worst case is one failed poll, not a dead feed. Radar/scout image loads
get the same treatment via a settle-timeout on the `Image` promise.

## Watchdog (`src/utils/health.js`)

Every loop registers with the health registry and reports two signals:

- `attempt()` — "my loop is alive and trying" (fires even on fetch failure)
- `ok()` — "I actually got fresh data"

The watchdog (30 s tick) responds differently to each failure shape:

| Condition | Meaning | Response |
|---|---|---|
| attempts stopped (critical feed) | loop/timer is dead | reload the page |
| attempts stopped (non-critical) | minor loop dead | console warning |
| attempts continue, `ok()` stale | upstream API outage | keep retrying; chip shows data age |

**Critical feeds** (reload-worthy): `alerts` (30 s poll), `radar-refresh`
(5 min cache-bust), `director` (1 s camera tick — withholds its heartbeat if
`advance()` throws persistently, so a wedged director also trips the reload).
A loop counts as dead after `max(5 × pollMs, 5 min)` of silence — the floor
absorbs GC pauses and background-tab timer throttling.

**Reload guards:** at most one watchdog reload per 15 min (localStorage
timestamp — can't loop), and never while `navigator.onLine === false` (a
reload can't fix a dead network; it would just blank the OBS capture).

**Known limit:** an in-page watchdog can't recover a fully crashed renderer
(OOM tab kill, GPU crash) — its own timer dies with everything else. The VPS
needs one supervisor *outside* the browser: OBS's browser-source
"Refresh browser when scene becomes active" plus a cron that restarts the
browser/OBS if the process dies is enough.

## Staleness chip (`src/ui/status-chip.js`)

The bottom-left chip re-renders from the health registry on its own 5 s clock
— a dead poll loop can't freeze it at a reassuring old timestamp.

- fresh: `● LIVE · data 4:52 PM`
- \> 2 min since alert data: appends amber `· retrying` (quiet — api.weather.gov burps routinely)
- \> 5 min: amber `data as of 4:52 PM · 12 min old`
- \> 15 min since a radar tile loaded successfully: amber `radar 22 min old`

Times are pinned to America/Chicago so a UTC-clocked VPS shows viewer-local time.

## Soak test

Goal: 24–48 h under continuous layer churn with no heap growth trend.

1. `npm run dev`, then open in Chrome (ideally launched with
   `--enable-precise-memory-info` for unquantized heap numbers):

   `http://localhost:5173/?replay=demo-outbreak&loop&soak`

   - `loop` restarts the replay script ~10 s after its last alert ends, so
     warning tours / layer churn / popup timers run indefinitely.
     (`?replay=loop-smoke&loop` is a two-warning script that wraps every
     ~70 s — handy for checking the loop machinery without waiting out the
     full outbreak.)
   - `soak` logs one JSON line per minute: heap MB, DOM node count, Leaflet
     layer count, radar image-cache size. The whole run accumulates on
     `window.__soak` — `copy(window.__soak)` in DevTools to export.
2. Leave it 24–48 h. Also worth one live-mode run (`/?soak`) to soak the real
   pollers.
3. Pass criteria: `heapMB` sawtooths (GC) but the floor doesn't climb across
   hours; `dom` and `layers` oscillate around constants; `imgCache` stays ≤ 900.

For unattended runs, keep the tab foregrounded (or launch Chrome with
`--disable-background-timer-throttling --disable-renderer-backgrounding`) —
the same flags the VPS/OBS launch should use, since a captured-but-occluded
tab is otherwise throttled to ~1 timer/min.

## Bounded caches (leak fixes that rode along)

- `alerts.js` / `reports.js` `seen` sets → Maps with a 24 h TTL sweep
- `mcd.js` product-text cache → capped at 100 entries
- radar `imgCache` was already capped (900) — now also can't strand
  never-settling promises
