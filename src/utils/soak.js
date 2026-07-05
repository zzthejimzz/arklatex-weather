// Soak-test monitor, enabled with ?soak. Samples the leak candidates once a
// minute — JS heap (Chrome-only; launch with --enable-precise-memory-info for
// non-quantized numbers), DOM node count, live Leaflet layer count, radar
// image-cache size — and logs each sample as one JSON line so a 24–48 h run
// can be scraped from the console log. The full run also accumulates on
// window.__soak: `copy(window.__soak)` in DevTools to pull it out.
const SAMPLE_MS = 60_000;

export function startSoakMonitor({ map, extras = {} }) {
  const samples = [];
  window.__soak = samples;
  const t0 = Date.now();

  const sample = () => {
    const m = performance.memory;
    const s = {
      upMin: Math.round((Date.now() - t0) / 60_000),
      heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null,
      dom: document.getElementsByTagName('*').length,
      layers: map ? Object.keys(map._layers).length : null,
    };
    for (const [k, fn] of Object.entries(extras)) {
      try { s[k] = fn(); } catch { s[k] = null; }
    }
    samples.push(s);
    console.log('[soak]', JSON.stringify(s));
  };

  sample();
  setInterval(sample, SAMPLE_MS);
}
