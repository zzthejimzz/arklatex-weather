// All on-air times render in Central time — the ArkLaTex is single-timezone.
const TZ = 'America/Chicago';

const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour: 'numeric', minute: '2-digit',
});
const clockFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric',
});

export function formatLocalTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : timeFmt.format(d);
}

export function formatClock(d = new Date()) {
  return { date: dateFmt.format(d), time: `${clockFmt.format(d)} CT` };
}

export function formatDate(d) {
  return d instanceof Date && !isNaN(d) ? dateFmt.format(d) : null;
}

// "1:04:32" / "24:15" remaining until `iso`, or "EXPIRED".
export function countdown(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  if (isNaN(ms)) return null;
  if (ms <= 0) return 'EXPIRED';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function expiresSoon(iso, thresholdMin = 10) {
  const ms = new Date(iso) - Date.now();
  return !isNaN(ms) && ms > 0 && ms < thresholdMin * 60 * 1000;
}
