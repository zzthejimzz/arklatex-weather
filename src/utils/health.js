// Central health registry + watchdog for unattended 24/7 running.
//
// Every polling loop registers itself and reports two separate signals:
//   attempt() — "my loop is alive and trying" (called even when the fetch fails)
//   ok()      — "I actually got fresh data"
// The distinction drives two very different responses:
//   attempts stopped → the loop itself is dead (timer wedged, renderer stalled,
//                      an exception path nobody foresaw) → reload the page.
//   attempts continue but ok() is stale → upstream outage → keep retrying and
//                      let the status chip show the data age; a reload can't fix
//                      someone else's API.
//
// The reload is deliberately blunt: the app boots to full state in seconds and
// holds no local state worth preserving, so a clean reload is the most reliable
// recovery there is. It's rate-limited via localStorage so a reload can never
// loop, and skipped while the machine knows it's offline.
const feeds = new Map(); // name → { pollMs, critical, lastAttempt, lastOk }

const WATCHDOG_TICK_MS = 30_000;
const RELOAD_MIN_GAP_MS = 15 * 60 * 1000;
const RELOAD_KEY = 'wx-watchdog-reload-at';

// A loop is "dead" after missing several cycles, with a floor so fast loops
// (the director ticks every second) aren't reloaded over a brief GC pause or
// background-tab throttling, which clamps timers to once a minute.
function deadAfter(pollMs) {
  return Math.max(pollMs * 5, 5 * 60 * 1000);
}

// DevTools/soak hook: `__health()` dumps every feed's freshness — first thing
// to check when the stream looks wrong on the VPS.
window.__health = () => Object.fromEntries(
  [...feeds].map(([name, f]) => [name, {
    ...f,
    sinceAttemptMs: Date.now() - f.lastAttempt,
    sinceOkMs: f.lastOk ? Date.now() - f.lastOk : null,
  }]),
);

export function track(name, { pollMs, critical = false } = {}) {
  const f = { pollMs, critical, lastAttempt: Date.now(), lastOk: 0 };
  feeds.set(name, f);
  return {
    attempt() { f.lastAttempt = Date.now(); },
    ok() { const now = Date.now(); f.lastAttempt = now; f.lastOk = now; },
  };
}

// Data age per feed, for the status chip: ms since last successful update,
// or null if the feed has never succeeded (still booting).
export function ageOf(name) {
  const f = feeds.get(name);
  if (!f || !f.lastOk) return null;
  return Date.now() - f.lastOk;
}

function tryReload(reason) {
  if (navigator.onLine === false) {
    console.error(`[watchdog] ${reason} — but offline, holding for reconnect`);
    return;
  }
  let last = 0;
  try { last = Number(localStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage off */ }
  if (Date.now() - last < RELOAD_MIN_GAP_MS) {
    console.error(`[watchdog] ${reason} — reloaded recently, not looping`);
    return;
  }
  try { localStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage off */ }
  console.error(`[watchdog] ${reason} — reloading page`);
  location.reload();
}

export function startWatchdog() {
  // Surface silent failures in the console log the VPS will keep — an
  // unhandled rejection in a callback path is exactly the kind of thing
  // nobody sees until the stream has been wrong for a day.
  window.addEventListener('unhandledrejection', e => {
    console.error('[watchdog] unhandled rejection:', e.reason);
  });
  window.addEventListener('error', e => {
    console.error('[watchdog] uncaught error:', e.message);
  });

  setInterval(() => {
    const now = Date.now();
    for (const [name, f] of feeds) {
      const silent = now - f.lastAttempt;
      if (silent <= deadAfter(f.pollMs)) continue;
      if (f.critical) {
        tryReload(`"${name}" loop silent for ${Math.round(silent / 60000)} min`);
        return; // one reload attempt per tick is plenty
      }
      console.warn(`[watchdog] non-critical loop "${name}" silent for ${Math.round(silent / 60000)} min`);
    }
  }, WATCHDOG_TICK_MS);
}
