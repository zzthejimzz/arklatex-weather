// Buoy camera card: one NDBC buoy's six-camera panorama, cut into its six
// 16:9 views and laid out 2×3 on the right, with the buoy's latest wind /
// wave / pressure on top — plus a pulsing pin on the map so the satellite
// shot behind it shows where the buoy sits relative to the storm.
import L from 'leaflet';
import { icon } from './icons.js';
import { VIEWS } from '../data/buoycam.js';

// Background-size scales the whole panorama strip so one view fills a panel;
// the caption strip falls below the panel's bottom edge.

function ago(date) {
  const min = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} hr ${min % 60} min ago`;
}

function cell(label, value, unit) {
  const v = value == null ? '—' : `${value}<span class="bc-unit">${unit}</span>`;
  return `<div class="bc-cell"><span class="bc-label">${label}</span><span class="bc-val">${v}</span></div>`;
}

export function createBuoycamCard(map) {
  const root = document.getElementById('buoycam-root');
  let marker = null;
  let token = 0;

  // `station` comes from buoycam.near(); `photoPromise` (buoycam.photo())
  // resolves to the brightened image + which views are live, `obsPromise` to
  // the station's observations — the card paints first and each part fills
  // in when it lands. Either may resolve null.
  function show(station, { stormName, photoPromise, obsPromise } = {}) {
    if (!root || !station) return false;
    const my = ++token;
    const time = station.takenAt.toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
    const miles = Math.round(station.km * 0.621371);
    const dist = stormName ? ` · ${miles} mi from ${stormName}'s center` : '';
    const panels = Array.from({ length: VIEWS }, (_, i) =>
      `<div class="bc-panel" style="background-position:${(i / (VIEWS - 1)) * 100}% 0"></div>`,
    ).join('');
    root.innerHTML = `
      <div class="bc-card">
        <div class="bc-eyebrow">${icon('hurricane')} Offshore buoy camera · NOAA ${station.id}</div>
        <div class="bc-title">${station.where}</div>
        <div class="bc-sub">Photo ${time} · ${ago(station.takenAt)}${dist}</div>
        <div class="bc-stats">${cell('Wind', null, '')}${cell('Gusts', null, '')}${cell('Waves', null, '')}${cell('Pressure', null, '')}</div>
        <div class="bc-grid">${panels}</div>
        <div class="bc-credit">360° camera views · NOAA National Data Buoy Center</div>
      </div>`;
    root.style.display = 'block';

    Promise.resolve(photoPromise).then(p => {
      if (my !== token) return;
      const src = p?.url ?? station.img;
      root.querySelectorAll('.bc-panel').forEach((el, i) => {
        if (p && !p.live.includes(i)) el.remove(); // dead camera — drop it, the grid closes up
        else el.style.backgroundImage = `url('${src}')`;
      });
      if (p?.gain > 1) root.querySelector('.bc-credit')?.insertAdjacentText('beforeend', ' · brightened for visibility');
    });

    obsPromise?.then(o => {
      if (my !== token || !o) return;
      const stats = root.querySelector('.bc-stats');
      if (!stats) return;
      stats.innerHTML =
        cell('Wind', o.windMph != null ? `${o.windDir ?? ''} ${o.windMph}`.trim() : null, ' mph') +
        cell('Gusts', o.gustMph, ' mph') +
        cell('Waves', o.wavesFt, ' ft') +
        cell('Pressure', o.presIn, ' in');
    });

    marker?.remove();
    marker = L.marker([station.lat, station.lon], {
      icon: L.divIcon({
        className: 'buoy-marker',
        html: `<div class="buoy-pin"></div><div class="buoy-name">Buoy ${station.id}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      pane: 'reports',
      interactive: false,
      keyboard: false,
    }).addTo(map);
    return true;
  }

  function hide() {
    token++;
    if (root) {
      root.style.display = 'none';
      root.innerHTML = '';
    }
    marker?.remove();
    marker = null;
  }

  return { show, hide };
}
