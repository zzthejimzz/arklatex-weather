// Music widget in the top banner: an ambient orange equalizer + the current
// track title, sitting just left of the brand/clock box.
//
// The bars are decorative, not FFT-driven: the page has no access to the
// audio (mpv streams it straight into the encoder on the VPS), and putting
// audio in the browser would restart the playlist on every watchdog reload.
// At banner size a desynced CSS equalizer is indistinguishable from a
// reactive one. The *title* is real — mpv writes it to a file on each track
// change (deploy/nowplaying.lua) and serve.js exposes it at /nowplaying.
//
// Dev override: append ?np=Some+Title to preview a title without the
// streaming stack (the /nowplaying endpoint only exists in the prod server).

const BAR_COUNT = 14;
const POLL_MS = 5000;

export function mountNowPlaying(bannerEl) {
  const brand = bannerEl.querySelector('.banner-brand');
  if (!brand) return;

  const w = document.createElement('div');
  w.className = 'banner-music is-idle';
  w.innerHTML = `
    <div class="bm-eq" aria-hidden="true">${'<span></span>'.repeat(BAR_COUNT)}</div>
    <div class="bm-meta">
      <div class="bm-label">Now Playing</div>
      <div class="bm-title"></div>
    </div>`;
  bannerEl.insertBefore(w, brand);

  const titleEl = w.querySelector('.bm-title');
  let last = null;

  function setTitle(t) {
    const s = (t || '').trim();
    if (s === last) return;
    last = s;
    titleEl.textContent = s || '—';
    w.classList.toggle('is-idle', !s);
  }

  const override = new URLSearchParams(location.search).get('np');
  if (override !== null) {
    setTitle(override);
    return; // static preview — don't poll
  }

  async function poll() {
    try {
      const r = await fetch('/nowplaying', { cache: 'no-store' });
      setTitle(r.ok ? await r.text() : '');
    } catch {
      /* transient — keep showing the last known title */
    }
  }
  poll();
  setInterval(poll, POLL_MS);
}
