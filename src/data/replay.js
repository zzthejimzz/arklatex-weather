// Replay alert source — drop-in replacement for the live poller so the
// director/banner/popup can be developed and demoed on quiet weather days.
// Load with ?replay=<name> → fetches /replay/<name>.json:
//   { "speed": 1, "alerts": [{ "delaySec", "durationSec", "feature" }, ...] }
// Features are time-shifted to "now" so countdowns behave like live data.
import { enrichAlert } from './alerts.js';

const TICK_MS = 2_000;

export function createReplaySource(geo, name, { loop = false } = {}) {
  let timer = null;

  return {
    mode: 'REPLAY',
    async start(onUpdate, onStatus = () => {}) {
      let script;
      try {
        const res = await fetch(`/replay/${encodeURIComponent(name)}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        script = await res.json();
      } catch (err) {
        console.error(`[replay] failed to load "${name}":`, err);
        onStatus({ ok: false, at: Date.now(), error: String(err) });
        return;
      }

      const speed = script.speed ?? 1;
      let t0 = Date.now();
      let activated = new Set();
      // Loop mode (?loop, for soak testing): restart the script a beat after
      // the last alert ends, so layer churn runs indefinitely.
      const scriptEndSec = Math.max(0, ...script.alerts.map(a => a.delaySec + a.durationSec));

      const tick = () => {
        let elapsed = ((Date.now() - t0) / 1000) * speed;
        if (loop && elapsed > scriptEndSec + 10) {
          t0 = Date.now();
          activated = new Set();
          elapsed = 0;
        }
        const active = [];
        const added = [];

        script.alerts.forEach((entry, i) => {
          const { delaySec, durationSec } = entry;
          if (elapsed < delaySec || elapsed > delaySec + durationSec) return;

          const feature = structuredClone(entry.feature);
          const start = new Date(t0 + (delaySec / speed) * 1000).toISOString();
          const end = new Date(t0 + ((delaySec + durationSec) / speed) * 1000).toISOString();
          feature.properties.id = feature.properties.id ?? `replay-${i}`;
          feature.properties.sent = start;
          feature.properties.effective = start;
          feature.properties.onset = start;
          feature.properties.expires = end;

          const alert = enrichAlert(feature, geo);
          alert.key = `replay-${i}`;
          active.push(alert);
          if (!activated.has(i)) {
            activated.add(i);
            added.push(alert);
          }
        });

        active.sort((a, b) => b.score - a.score);
        onStatus({ ok: true, at: Date.now() });
        onUpdate({ alerts: active, added });
      };

      tick();
      timer = setInterval(tick, TICK_MS);
    },
    stop() { clearInterval(timer); },
  };
}
