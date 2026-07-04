// Severity ranking for the director and banner. Higher = more urgent.
// NWS CAP parameters (properties.parameters) carry the impact tags:
//   tornadoDetection: RADAR INDICATED | OBSERVED
//   tornadoDamageThreat: CONSIDERABLE (PDS) | CATASTROPHIC (emergency)
//   thunderstormDamageThreat: CONSIDERABLE | DESTRUCTIVE

export function param(props, key) {
  const v = props?.parameters?.[key];
  return Array.isArray(v) ? v[0] : v ?? null;
}

export function scoreAlert(props) {
  const ev = (props.event || '').toLowerCase();
  const text = `${props.headline ?? ''} ${props.description ?? ''}`;
  const torThreat = String(param(props, 'tornadoDamageThreat') ?? '').toUpperCase();
  const stormThreat = String(param(props, 'thunderstormDamageThreat') ?? '').toUpperCase();
  const detection = String(param(props, 'tornadoDetection') ?? '').toUpperCase();

  if (ev === 'tornado warning') {
    if (torThreat === 'CATASTROPHIC' || /tornado emergency/i.test(text)) return 100;
    if (torThreat === 'CONSIDERABLE') return 90;
    return detection === 'OBSERVED' ? 85 : 80;
  }
  if (ev === 'extreme wind warning') return 88;
  if (ev === 'severe thunderstorm warning') {
    if (stormThreat === 'DESTRUCTIVE') return 70;
    if (stormThreat === 'CONSIDERABLE') return 60;
    return 50;
  }
  if (ev === 'flash flood warning') {
    return /flash flood emergency/i.test(text) ? 75 : 45;
  }
  if (ev === 'tornado watch') return 30;
  if (ev === 'severe thunderstorm watch') return 25;
  if (ev === 'flood warning') return 20;

  const sev = (props.severity || '').toLowerCase();
  if (sev === 'extreme') return 18;
  if (sev === 'severe') return 12;
  if (sev === 'moderate') return 6;
  return 2;
}

// Only warnings get the pan-and-zoom treatment; watches/advisories stay on the
// map but the camera doesn't chase them.
const TOUR_THRESHOLD = 40;

export function isTourable(alert) {
  return alert.score >= TOUR_THRESHOLD && !!alert.geometry;
}
