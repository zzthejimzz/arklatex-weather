// Aurora / geomagnetic-storm outlook from NOAA SWPC: the 3-hourly planetary
// Kp index (recent observed + ~3-day forecast) and the official NOAA G-scale
// (current + Day 1-3), both small CORS-open JSON products, no key needed.
// National product like the tropical outlook — no locality gate, just a
// quiet-day filler that's almost always "G0, nothing to see" but occasionally
// the real story.
import { fetchWithTimeout } from '../utils/net.js';

const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const SCALES_URL = 'https://services.swpc.noaa.gov/products/noaa-scales.json';
const REFRESH_MS = 20 * 60 * 1000; // Kp reissues a few times/day; scales updates continuously
const RETRY_MS = 5 * 60 * 1000;

// NOAA's own public G-scale (geomagnetic storm) descriptions — the
// visibility ranges are their wording, not derived. The ArkLaTex sits at
// roughly Alabama's latitude, so G4 is the first level that puts aurora
// within reach locally, and only G5 clearly does.
export const G_SCALE = [
  { scale: 0, label: 'G0 — Quiet',    color: '#4ade80', visible: 'No storm — aurora stays confined near the poles.' },
  { scale: 1, label: 'G1 — Minor',    color: '#a3e635', visible: 'May dip into the far northern U.S. — Michigan, Maine.' },
  { scale: 2, label: 'G2 — Moderate', color: '#facc15', visible: 'Visible as far south as New York, Idaho.' },
  { scale: 3, label: 'G3 — Strong',   color: '#fb923c', visible: 'Visible as far south as Illinois, Oregon.' },
  { scale: 4, label: 'G4 — Severe',   color: '#f87171', visible: 'Visible as far south as Alabama, northern California.' },
  { scale: 5, label: 'G5 — Extreme',  color: '#e879f9', visible: 'Visible as far south as Florida, southern Texas.' },
];

// The first level where the ArkLaTex itself is plausibly in range.
export const LOCAL_THRESHOLD = 4;

function gInfo(scale) {
  return G_SCALE[Math.max(0, Math.min(5, Math.round(scale) || 0))];
}

// Kp → G-scale: G0 below Kp 5, then each whole Kp step from 5-9 is G1-G5.
// (This is NOAA's own mapping, used only for the *forecast Kp* peak — the
// day-by-day G-scale itself comes straight from the noaa-scales product.)
function kpToG(kp) {
  return gInfo(kp < 5 ? 0 : kp - 4);
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url, { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function createAuroraSource() {
  let data = null;

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const [kpRows, scalesObj] = await Promise.all([fetchJson(KP_URL), fetchJson(SCALES_URL)]);
      // Row 0 is the header-ish duplicate-free first sample; every row after
      // is time-ordered, observed history then predicted future.
      const rows = kpRows.slice(1)
        .map(r => ({ time: new Date(`${r.time_tag}Z`), kp: Number(r.kp), predicted: r.observed === 'predicted' }))
        .filter(r => !isNaN(r.time) && Number.isFinite(r.kp));
      const observed = rows.filter(r => !r.predicted);
      const predicted = rows.filter(r => r.predicted);
      const current = observed[observed.length - 1] ?? null;
      const peakRow = predicted.reduce((best, r) => (!best || r.kp > best.kp ? r : best), null);
      const peak = peakRow && { ...peakRow, ...kpToG(peakRow.kp) };
      if (!current) throw new Error('no observed Kp rows');

      const DAY_LABELS = ['Today', 'Tomorrow'];
      const days = ['1', '2', '3'].map((k, i) => {
        const row = scalesObj[k];
        const scale = Number(row?.G?.Scale ?? 0);
        const date = row ? new Date(`${row.DateStamp}T00:00:00Z`) : null;
        const day = DAY_LABELS[i] ?? (date ? date.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' }) : `Day ${i + 1}`);
        return { day, ...gInfo(scale) };
      });
      const currentG = gInfo(scalesObj['0']?.G?.Scale ?? 0);

      data = {
        updatedAt: new Date(),
        current,
        currentG,
        peak,
        days,
        worstScale: Math.max(currentG.scale, peak?.scale ?? 0, ...days.map(d => d.scale)),
      };
    } catch (err) {
      console.warn('[aurora] fetch failed:', err);
      if (!data) delay = RETRY_MS;
    } finally {
      setTimeout(poll, delay);
    }
  }

  return {
    start() { poll(); },
    ready: () => data != null,
    get: () => data,
  };
}
