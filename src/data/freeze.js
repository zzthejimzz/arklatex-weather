// Freeze-hazard read for the director's "Freeze Safety" page — the cold-season
// twin of heat.js. No feed of its own: it inspects the live NWS alerts the
// director already holds and picks the most urgent freeze product in effect.
import { styleForEvent } from '../utils/alert-style.js';

// NWS freeze events, most urgent first. A hard freeze (28°F or colder for
// several hours) outranks a plain freeze (32°F); a watch means it's possible
// but not yet imminent. Order matters: "Freeze Warning" also matches the tail
// of "Hard Freeze Warning", so the hard tiers are tested first.
const FREEZE_TIERS = [
  { re: /hard freeze warning/i, tier: 'hard-warning' },
  { re: /freeze warning/i,      tier: 'warning' },
  { re: /hard freeze watch/i,   tier: 'hard-watch' },
  { re: /freeze watch/i,        tier: 'watch' },
];
const RANK = { 'hard-warning': 4, warning: 3, 'hard-watch': 2, watch: 1 };

function tierFor(event) {
  return FREEZE_TIERS.find(t => t.re.test(event))?.tier ?? null;
}

// Most urgent freeze product in effect across the region, or null. Same shape
// as heatAlert(): `count` and `keys` cover every alert sharing the top tier so
// the director can flash exactly those polygons while the card is up.
export function freezeAlert(alerts = []) {
  let best = null;
  for (const a of alerts) {
    const tier = tierFor(a.props?.event ?? '');
    if (!tier) continue;
    if (!best || RANK[tier] > RANK[best.tier]) best = { tier, event: a.props.event };
  }
  if (!best) return null;
  const top = alerts.filter(a => tierFor(a.props?.event ?? '') === best.tier);
  return {
    ...best,
    count: top.length,
    keys: top.map(a => a.key).filter(Boolean),
    color: styleForEvent(best.event).color,
  };
}
