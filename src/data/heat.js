// Heat-hazard read for the director's "Heat Safety" page. No feed of its own —
// it inspects the live NWS alerts the director already holds, picks the most
// urgent heat product in effect, and reports its tier so the director knows how
// hard to push the safety tips (a warning gets woven through the lap; a lesser
// advisory/watch airs once).
import { styleForEvent } from '../utils/alert-style.js';

// NWS heat events, most urgent first. "Extreme Heat" is the current NWS wording
// (it replaced "Excessive Heat" in 2024) — both are matched so the module works
// before and after the rename. A Heat Advisory is the lesser-but-active tier; a
// watch means dangerous heat is possible but not yet imminent.
const HEAT_TIERS = [
  { re: /(extreme|excessive) heat warning/i, tier: 'warning' },
  { re: /heat advisory/i,                    tier: 'advisory' },
  { re: /(extreme|excessive) heat watch/i,   tier: 'watch' },
];
const RANK = { warning: 3, advisory: 2, watch: 1 };

function tierFor(event) {
  return HEAT_TIERS.find(t => t.re.test(event))?.tier ?? null;
}

// Most urgent heat product in effect across the region, or null. `count` is how
// many separate alerts share the top tier — a stand-in for how widespread the
// heat is across the region's zones.
export function heatAlert(alerts = []) {
  let best = null;
  for (const a of alerts) {
    const tier = tierFor(a.props?.event ?? '');
    if (!tier) continue;
    if (!best || RANK[tier] > RANK[best.tier]) best = { tier, event: a.props.event };
  }
  if (!best) return null;
  const count = alerts.filter(a => tierFor(a.props?.event ?? '') === best.tier).length;
  return { ...best, count, color: styleForEvent(best.event).color };
}
