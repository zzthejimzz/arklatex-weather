# ArkLaTex Weather Live — Visual Identity & Style Guide

Living implementation guide. The self-hosted typography and custom SVG icon system described
here are now implemented; this document records the shipped choices and the rules for extending
them consistently.

---

## 1. Style direction

**Direction: Modern broadcast-news graphics, tuned toward mission-control telemetry —
not avionics/HUD.**

The app already commits to this without saying so: gradient headline text, pill tags, colored
severity borders, mono readouts for every number, a scrolling lower-third ticker, a persistent
banner. That's the visual grammar of a 2020s cable-weather or ESPN-style broadcast graphics
package (think The Weather Channel's "Max," or a modern NFL/NHL score bug), not a cockpit
instrument panel. Two reference points to keep in mind while extending it:

1. **Broadcast news graphics** for structure — banner/ticker/card chrome, gradient titles,
   severity-colored accents, pill badges, glassy translucent panels over a busy background
   (the map). This is the dominant note and should stay dominant.
2. **Mission-control telemetry** for *texture only* — the mono-numeral readouts, uppercase
   letter-spaced labels, hairline borders, and sonar-ping pulses on map pins already borrow
   this vocabulary, and the icon system should keep borrowing it: thin, geometric, precise
   line marks rather than soft illustrative glyphs. This is a system reporting facts under
   time pressure, not a friendly consumer weather app — icons should read like instrument
   symbols, not stickers.

Avoid pure avionics/HUD (crosshairs, tick-mark compass roses, targeting reticles) — it would
fight the already-established rounded-corner, pill-badge broadcast chrome and imply a
control-you-fly-with UI this isn't. Avoid flat "friendly" icon packs (rounded blob suns, cartoon
raindrops) — they'd clash with the mono/uppercase/hairline precision already in the CSS.

---

## 2. Typography

### Display / UI sans — **Manrope**
- Source: [github.com/sharanda/manrope](https://github.com/sharanda/manrope) (canonical repo) or
  mirrored on [Google Fonts](https://fonts.google.com/specimen/Manrope) — download the static
  `.ttf`/`.woff2` files from either and self-host; do not link fonts.googleapis.com at runtime.
- License: **SIL Open Font License 1.1** — free for commercial broadcast use, no attribution
  required in the stream itself (though keeping the OFL.txt alongside the font files in the repo
  is good practice).
- Weights needed: 400, 500, 600, 700, 800 — Manrope ships all five as static instances (it's
  also a variable font, but pin static weight files for headless-Chromium determinism; variable
  fonts have had inconsistent `font-variation-settings` rasterization across Chromium versions
  in the past, and this app needs pixel-identical repeats of the same shot every cycle).
- Why it fits: geometric grotesque with a slightly condensed, high-x-height character that holds
  up at both the 12–13px pin/label extreme and the 30–46px card-title extreme. It has a
  distinct 8-weight family so the existing 800-weight badge/headline pattern (`font-weight: 800`
  shows up throughout `broadcast.css`) has a real matching cut instead of synthetic-bold
  browser faking, which headless Chromium renders slightly differently across weights than
  a real design does.

### Monospace — **JetBrains Mono**
- Keep it — it is the CSS token (`--font-mono`), is correct for this use case, and its static
  cuts are now self-hosted with the rest of the broadcast typography.
- Source: [github.com/JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) —
  download static `.woff2` files from the repo's `fonts/webfonts/` directory (or the release
  ZIP on the repo's Releases page). Self-host; no CDN call.
- License: **SIL Open Font License 1.1** — same commercial-broadcast clearance as Manrope.
- Weights needed: 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold), 800 (ExtraBold) —
  all five exist as static cuts in the official release.
- Why it fits: tabular figures by default (critical — temperature columns, gauge stage
  readouts, and the record-span meter's numeric ticks must not jitter horizontally frame to
  frame), unambiguous glyphs at small sizes (0/O, 1/l/I are all distinguished), and it already
  matches every `font-family: var(--font-mono)` rule in the codebase so zero markup changes
  are implied by adopting it for real.

### Self-hosting setup (implemented)
Static `.woff2` files live under `public/fonts/manrope/` and
`public/fonts/jetbrains-mono/`, with the matching OFL license beside each family. They are
declared at the top of `src/broadcast.css`:

```css
@font-face {
  font-family: 'Manrope';
  src: url('/fonts/manrope/Manrope-Regular.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: block;
}
/* repeat per weight: 500, 600, 700, 800 */

@font-face {
  font-family: 'JetBrains Mono';
  src: url('/fonts/jetbrains-mono/JetBrainsMono-Regular.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: block;
}
/* repeat per weight: 500, 600, 700, 800 */
```

Use `font-display: block` (not `swap`) — this is a headless-Chromium capture rig, not a
user-facing page waiting on a network. There's no acceptable "flash of fallback font" moment
because every frame gets encoded into the stream; block briefly at load (fonts are local files,
this is milliseconds) rather than ever showing system-ui in a broadcast frame.

### Updated CSS custom properties (fallback stacks)
```css
--font-sans: 'Manrope', 'Segoe UI', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Cascadia Mono', 'Consolas', monospace;
```
The fallback stack matters only as a crash guard — if the self-hosted files ever fail to load,
the capture box should degrade to *a* sans/mono rather than produce `[tofu]` boxes, but this
should never be relied upon in normal operation.

---

## 3. Design tokens (confirmed / refined)

The existing `:root` token set in `src/broadcast.css` is sound. Confirmed as-is, with two
additions the icon system needs (a stroke-width and an icon-size scale) and one clarified
naming note.

```css
:root {
  /* Surfaces */
  --bg-base:      #080c14;
  --bg-card:      #0f1623;
  --bg-elevated:  #161d2e;
  --border:       #1e2a3d;
  --border-light: rgba(30, 42, 61, 0.5);

  /* Text */
  --text-primary: #f0f4ff;
  --text-muted:   #6b7fa3;
  --text-faint:   #3d4f6b;

  /* Accents (severity + brand) */
  --accent-blue:   #3b82f6;
  --accent-amber:  #f59e0b;
  --accent-cyan:   #22d3ee;
  --accent-purple: #a855f7;
  --accent-green:  #22c55e;
  --accent-red:    #ef4444;

  /* Type */
  --font-sans: 'Manrope', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Cascadia Mono', 'Consolas', monospace;

  /* Layout constants (existing) */
  --banner-h: 96px;
  --ticker-h: 52px;

  /* Icon system */
  --icon-stroke: 1.75;      /* SVG stroke-width at 24×24 native grid; scales with viewBox */
  --icon-size-xs: 15px;     /* river-pin glyph scale (river-pin is 30px circle) */
  --icon-size-sm: 19px;     /* warn-row / ticker glyph scale */
  --icon-size-md: 34px;     /* lsr-pin glyph, moon-row icon */
  --icon-size-lg: 42px;     /* fc-ico forecast icon */
  --icon-size-xl: 84px;     /* moon-hero icon */
}
```

No light-mode variant exists or is needed — this theme is never toggled, it's a fixed broadcast
look. Don't add `prefers-color-scheme` handling anywhere in this app.

---

## 4. Type scale

The codebase doesn't use a formal named scale today — sizes were picked per-component. This
table documents what's *already in use* (audited from `broadcast.css`) as the canonical scale
going forward, so new components pick from this list instead of inventing a new size.

| Token (informal) | px | Weight | Usage |
|---|---|---|---|
| micro | 11–12px | 500–600 | `city-label.tier-3`, `count-chip .abbr`, small map labels |
| caption | 13–15px | 500–700 | `warn-row .w-label`, `fc-state`, `alm-cell .ac-label`, pill text |
| body-sm | 15–17px | 500–600 | `warn-row`, `tk-dim`, `aur-row .ar-vis`, secondary readouts |
| body | 18–21px | 500–700 | `banner-alert-meta`, `fc-spot-row .sr-temp`, `moon-row .mr-name` |
| title-sm | 23–26px | 700–800 | `fc-name`, `count-chip .count`, `warn-card-event` |
| title | 28–30px | 700–800 | `#outlook-chip`, `fc-title` |
| hero-num | 34–46px | 800 | `moon-hero .mh-name`, `alm-now .an-read b`, `pollen-day .pd-val` |
| display-num | 60–84px | 800 | `alm-cell .ac-val` (60), `alm-rec .ac-val` (82), `moon-hero .mh-emoji`/icon (84) |

Rules:
- Weight 800 is reserved for the single most important number/word on a card (hero readout,
  badge text, gradient headline). Don't use 800 for body copy — it should stay a landmark
  weight, not a default.
- Mono (`--font-mono`) is used for *every* numeric, timestamp, coordinate, or code value
  (temps, dates, "IN 4 DAYS", stage readings). Sans (`--font-sans`) is used for *every* label,
  name, and sentence. Never mix — a temperature number in sans or a place name in mono is a
  bug, not a style choice.
- Uppercase + `letter-spacing: 0.05–0.12em` is the established treatment for eyebrow labels
  (`fc-dow`, `alm-sec`, `w-label`, badge text). Keep letter-spacing proportional to size — the
  smaller the label, the more spacing it needs to stay legible (12px labels run ~0.08–0.12em,
  18px+ labels run ~0.02–0.05em).

---

## 5. Spacing scale

Also an audit-derived scale, not a new invention. Padding/gap values found in the CSS cluster
tightly around these steps — treat them as the grid:

`4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 22 · 24 · 28 · 32`  (px)

- Card internal padding: 18–24px (see `.warn-card` 20/24, `#outlook-chip` 20/28,
  `.moon-hero` 18/26).
- Row/cell gaps within a card: 8–14px.
- Card-to-card or section-to-section spacing: 12–16px top margin (`.alm-sec`, `.alm-now`).
- Component border-radius: 10–14px for cards/chips, 999px (full pill) for tags/badges. Don't
  introduce a third radius value — everything is either "card-rounded" or "pill."

---

## 6. Icon usage rules

- **Role-based grids**: weather conditions and hazards use a 32×32 viewBox for stronger
  silhouettes and more useful negative space. Compact metadata and utility marks use 24×24.
  Do not force display artwork and tiny operational symbols onto one optical grid.
- **Stroke weight**: weather/hazard marks use 2.2 at 32×32, with selected high-energy marks
  (wind and tornado bands) allowed to reach 2.8–3. Utility icons use 1.75 at 24×24. Rounded
  caps and joins remain the family-wide construction language.
- **Fill vs. outline**: forecast conditions are semi-filled pictograms. Clouds and temperature
  bodies use solid mass, while precipitation, rays, wind, and lightning provide sharp internal
  detail. Hazard and map-marker versions remain compact monochrome symbols. Utility marks stay
  primarily outline-based so they do not compete with weather information.
- **Color**: SVG geometry defaults to `currentColor`, keeping every mark usable in severity-
  colored alerts and markers. Named internal classes (`wx-cloud`, `wx-sun`, `wx-precip`, etc.)
  receive semantic colors only inside forecast display containers. Do not hardcode palette
  colors in SVG markup; keep them in `broadcast.css`.
- **Corner language**: rounded joins and caps unify the families. Filled lightning, hail, and
  temperature accents can use sharper geometry where the subject calls for urgency.
- **Sizing tokens**: use the `--icon-size-*` scale from Section 3. Don't pick an arbitrary
  pixel size per instance.
- **Coordinate rather than duplicate.** New weather, hazard, and utility marks must match the
  appropriate role family. Do not use emoji or introduce an unrelated runtime icon library as
  a stopgap.
- **Verify optical sizes.** Review every weather/hazard mark at 42, 34, 19, and 15px on the
  actual dark surfaces used by the app. A simplified compact variant is allowed when a display
  drawing cannot survive the smallest marker size.

---

## 7. Motion / animation rules

Existing vocabulary (from `broadcast.css`, confirmed as canonical — extend, don't replace):

| Name | Duration | Easing | Use case |
|---|---|---|---|
| `cardIn` | 0.35s | ease | Card/panel entrance (slide + fade from the right) |
| `badgePulse` | 1.2–2s | ease, infinite | Live/urgent badge brightness pulse (NEW tag, live-dot, banner badge) |
| `lsrPulse` | 2s | ease-out, infinite | Sonar ring expansion on a "visited" map pin (LSR + river pins share this) |
| `lsrPop` | 0.6s | cubic-bezier(0.2, 1.6, 0.4, 1) — overshoot | New pin spawning onto the map |
| `watchFlash` | 1.8s | ease-in-out, infinite | Watch-polygon outline opacity breathing while camera lingers |
| `warnFlash` | 0.8s | ease-in-out, infinite | Hard attention-strobe on a brand-new warning polygon (~10s window on arrival) |
| `tickerScroll` | 40s | linear, infinite | Lower-third ticker scroll |

Rules for new motion:
- **Entrances** (a card/panel appearing): 0.3–0.65s, ease or a gentle cubic-bezier overshoot
  like `cardIn`/`lsrPop`/the forecast panel's `cubic-bezier(0.22, 0.9, 0.3, 1)`. Never instant
  — but never longer than ~0.65s either, since the director is on a fixed shot clock and a slow
  entrance eats into a card's screen time.
- **Ambient/idle pulses** (live indicator, urgent badge): 1.2–2s, `ease`, infinite,
  brightness- or opacity-based only — never scale/position based, so it doesn't fight layout or
  distract from the data itself. This is the `badgePulse` contract; reuse it rather than writing
  a new keyframe for "something should feel alive."
  - **Attention pulses** (something the director wants the eye drawn to *right now* — new
  warning, freshly touched pin): faster, 0.6–0.8s cycle (`warnFlash`, `lsrPop`), and
  self-limiting in duration where possible (the 10s warnFlash window) rather than running
  forever — a permanent fast strobe reads as broken, not urgent.
- **New icon motion** (if any is added — e.g., a subtle rotation on a fire/wind icon): stay
  inside the existing timing bands above. Don't introduce spring physics, elastic bounces beyond
  the one overshoot curve already established, or anything longer than 2s for a loop — this
  is a continuously-running broadcast, and anything slower reads as sluggish over an 8+ hour
  encode session.
- `will-change: transform` only on the ticker (already applied) — don't blanket-apply it, it's
  a targeted perf hint for the one truly continuous transform-driven animation, not a default.

---

## 8. Color-to-severity mapping

Confirmed mapping, consolidated from `alert-style.js`, `river-gauge-layer.js`, `reports.js`,
and the `.tone-*`/`.an-pill.*`/`.alm-cell.*` CSS classes. This is the contract new features must
follow — don't invent a new severity color without checking this table first.

| Severity / category | Color | Token | Where it's used |
|---|---|---|---|
| Extreme / tornado / fire / heat | `#ff2b2b`–`#ef4444` red family | `--accent-red` | TOR warning, fire/red-flag, heat, `tone-red` |
| Severe / warning-tier, amber | `#f59e0b`–`#ffd23f` | `--accent-amber` | SVR, wind advisory, hot readouts, `tone-amber` |
| Flood / water, green | `#22c55e`–`#2ecc55` | `--accent-green` | FFW, flood warning/advisory, `tone-green` |
| Info / cyan | `#22d3ee` | `--accent-cyan` | MCD, hail LSR, gradient accents, unrecognized-alert fallback |
| Winter / cold / ice, blue-purple | `#3b82f6`, `#c86bfa`, `#b57edc` | `--accent-blue`, `--accent-purple` | Ice storm, winter storm, freeze/frost/cold |
| Neutral / muted | `#6b7fa3` / `#3d4f6b` | `--text-muted` / `--text-faint` | Quiet-day states, secondary metadata, "even" almanac pill |
| River gauge stages (ordered, low→high) | gold → orange → red → magenta | n/a (per-stage, see below) | `river-gauge-layer.js` |

River gauge stage colors (already defined, kept as-is):
`low_threshold #c9a227` → `action #ffe066` → `minor #ffa500` → `moderate #ff3b3b` → `major #c724ff`.
This is a deliberate warm→hot→magenta ramp distinct from the red/amber/green alert palette so
gauge severity never gets visually confused with a weather-alert severity on the same map.

Rule: severity color always drives the **border/ring/left-edge**, never the fill of a large
surface (cards stay on `--bg-card`/`--bg-elevated` regardless of severity) — this keeps the dark
broadcast background consistent while still making severity instantly scannable at a glance.

---

## 9. Do's and Don'ts

**Do**
- Use `currentColor` in every new icon so severity tinting is one CSS property away, exactly
  like today's emoji-in-a-colored-ring pattern.
- Keep every numeric/timestamp value in `--font-mono` with tabular figures.
- Reuse an existing animation name/timing before writing a new `@keyframes` — check Section 7
  first.
- Pick colors only from Section 8's table — if a new alert/category doesn't map cleanly, use
  the cyan/`--accent-cyan` fallback (already the unrecognized-alert default) rather than adding
  a new accent color.
- Author weather, hazard, moon, and other display/domain icons on the 32×32 role grid with a
  nominal `stroke-width="2.2"`. Author compact metadata and utility marks on the 24×24 grid
  with `stroke-width="1.75"`. In both families, use rounded caps/joins and `currentColor`.

**Don't**
- Don't add a light-mode branch, a `prefers-color-scheme` query, or a theme toggle anywhere.
- Don't hardcode hex colors inside new SVG icon markup.
- Don't introduce a third border-radius family — cards/chips are 10–14px, badges/tags are
  999px (pill), nothing else.
- Don't use font weights outside 400/500/600/700/800 — no 300, no 900, keeps rendering
  consistent in headless Chromium and matches the two chosen families' available static cuts.
- Don't rely on Google Fonts, any CDN, or any runtime network fetch for fonts or icons — this
  may run on an offline capture box, and every asset must be bundled/self-hosted.
- Don't animate longer than ~2s for any infinite loop, or slower than ~0.3s for any entrance —
  see Section 7's rationale (continuous multi-hour encode session).
- Don't restructure existing component layout/markup to fit a new visual idea — this is a style
  pass on a v1-final layout; new visual choices must slot into existing DOM structure.

---

## 10. How to add a new card/page (checklist)

Referencing existing component patterns so new work doesn't relitigate these choices:

1. **Does it ride the forecast panel or is it map-native?** Most non-map cards (`alm-*`,
   `moon-*`, `frost-*`, `uv-*`, `aqi-*`, `pollen-*`, `aur-*`) reuse `#forecast-root`'s slide-in
   panel (`cardIn`/panel-transform pattern) rather than inventing a new container. Default to
   this unless the content is inherently map-anchored (a new pin type, a new map overlay).
2. **Hero readout?** If the card has one headline number/state (current UV, current AQI, moon
   phase name), follow the `alm-now` / `moon-hero` pattern: translucent elevated box
   (`rgba(255,255,255,0.04)` bg, `--border-light` border, 12px radius), big mono or sans number
   at hero-num/display-num scale, small mono sub-label underneath.
3. **Row list?** If the card is a list of days/items (forecast days, moon phases, aurora
   nights), follow the `fc-spot-row` / `moon-row` / `aur-row` pattern: CSS grid row, `1px solid
   var(--border-light)` top divider, icon column + label column(s) + right-aligned mono value
   column(s).
4. **Cell grid?** If the card is a small set of stat tiles (almanac record/normal cells, AQI
   sub-pollutants), follow `.alm-cell` / `.aqi-cell`: `rgba(255,255,255,0.03)` bg,
   `--border-light` border, 12px radius, centered column layout, uppercase mono eyebrow label
   + big number + optional pill/tag below.
5. **Severity color?** Pull from Section 8's table. If introducing a genuinely new category
   (not a reskin of an existing one), pick the closest matching family and confirm against the
   existing `tone-*`/`an-pill.*` classes before adding a new CSS variable.
6. **Icon(s)?** Pull from Section 3's inventory (below) if the concept already exists (rain,
   wind, a moon phase, a report type). If genuinely new, author on the 24×24 grid per Section 6
   and add it to the inventory for reuse — don't let a one-off icon style drift from the set.
7. **Motion?** Entrance uses `cardIn` (or the panel's own slide-transform if riding
   `#forecast-root`, already handled for free). Any live/urgent element inside the card uses
   `badgePulse` timing. Don't add bespoke easing curves.
8. **Track/meter bar?** If the card needs a horizontal ramp (record-span, UV scale, AQI scale,
   pollen scale, aurora Kp scale), follow the `.alm-meter`/`am-track`/`am-band`/`am-now` pattern:
   a `linear-gradient` background bar defining hard percentage stops, a white `am-now` tick,
   optional `am-band` bracket for a "normal" range, mono-font end labels below.
9. **Ticker entry?** If the data point should also surface in the lower-third, add a `tk-item`
   using the existing `tk-icon`/`b`/`tk-dim`/`tk-sep` structure — don't build a parallel ticker
   pattern.
10. **Verify at both extremes.** Check the new component's icon/text at its smallest instance
    (map pin or ticker, ~13–17px) and its largest (hero card, ~60–84px) — the whole point of the
    24×24 stroke-based icon system and the Manrope/JetBrains Mono pick is that both extremes
    stay legible without special-casing.

---

## 11. Legacy icon path reference

> **Superseded artwork:** the SVG samples below document the first thin-outline pass and are
> retained only as a concept inventory. They must not be copied into the app. The canonical,
> role-based custom artwork lives in `src/ui/icons.js`, with forecast color treatment in
> `src/broadcast.css` and a production-size review surface at `/icon-review.html`.

Each icon below is hand-authored line art (no icon library). Drop into an inline `<svg>` or a
sprite sheet; size via CSS width/height per the `--icon-size-*` scale, color via the parent's
`color` CSS property.

### Weather conditions

**Rain**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M7 10.5a4.5 4.5 0 0 1 .6-8.96A6 6 0 0 1 19 6.5a4 4 0 0 1-1 7.9H7.5A3.5 3.5 0 0 1 7 10.5Z"/>
  <path d="M8 17.5 6.5 20" />
  <path d="M12 17.5 10.5 20" />
  <path d="M16 17.5 14.5 20" />
</svg>
```

**Thunderstorm / Tornado** *(shared funnel-storm mark — used for both TOR and generic severe
convective symbol; the brief groups these as one glyph)*
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M6.5 10.5a4.5 4.5 0 0 1 .6-8.96A6 6 0 0 1 18.5 6.5a4 4 0 0 1-1 7.9h-2.2"/>
  <path d="M9 14.5h4.5L10.5 19h3L11 22.5" fill="currentColor" stroke="none"/>
</svg>
```

**Tornado (funnel-only variant, for standalone TOR badge use)**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M3.5 5h17"/>
  <path d="M5.5 9h13"/>
  <path d="M7.5 13h9"/>
  <path d="M9.5 17h5"/>
  <path d="M11 21h2"/>
</svg>
```

**Wind**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 8h10.5a2.75 2.75 0 1 0-2.6-3.7"/>
  <path d="M3 13h14.5a2.75 2.75 0 1 1-2.6 3.7"/>
  <path d="M3 18h8.5a2.25 2.25 0 1 0-2.1-3"/>
</svg>
```

**Ice / Sleet**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.5v19"/>
  <path d="M4 7l16 10"/>
  <path d="M20 7 4 17"/>
  <path d="M8.3 4.2 12 6.5l3.7-2.3M8.3 19.8 12 17.5l3.7 2.3"/>
  <path d="M2.6 9.5 6 12l-3.4 2.5M21.4 9.5 18 12l3.4 2.5"/>
</svg>
```

**Clear / Sun**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="4.25"/>
  <path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>
</svg>
```

**Partly Cloudy**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M7 5.5V3.3M4.5 7H2.3M9.6 4.6 8.1 6.1"/>
  <circle cx="7" cy="9.2" r="2.6"/>
  <path d="M9.5 20.5H8a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17.9 10a3.6 3.6 0 0 1-.9 7.1V17"/>
</svg>
```

**Hot**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <rect x="9.75" y="2.5" width="4.5" height="12.5" rx="2.25"/>
  <circle cx="12" cy="18.5" r="3.25"/>
  <path d="M12 15v-6" stroke-width="2.25"/>
</svg>
```

### Alert / hazard types

**Flash Flood**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M2.5 18c1.4-1.3 2.7-1.3 4.1 0 1.4 1.3 2.7 1.3 4.1 0 1.4-1.3 2.7-1.3 4.1 0 1.4 1.3 2.7 1.3 4.1 0"/>
  <path d="M2.5 13.5c1.4-1.3 2.7-1.3 4.1 0 1.4 1.3 2.7 1.3 4.1 0 1.4-1.3 2.7-1.3 4.1 0 1.4 1.3 2.7 1.3 4.1 0"/>
  <path d="M13 2.5c-2 2.7-3 4.6-3 6.2a3 3 0 0 0 6 0c0-1.6-1-3.5-3-6.2Z"/>
</svg>
```

**Extreme Wind**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M2.5 7h11.8a2.6 2.6 0 1 0-2.5-3.4"/>
  <path d="M2.5 12h15.3a2.6 2.6 0 1 1-2.5 3.4"/>
  <path d="M2.5 17h9.8a2.1 2.1 0 1 0-2-2.8"/>
</svg>
```

**Flood Watch / Warning / Advisory** *(single water-level glyph; ring color + fill weight
distinguish watch vs. warning per Section 8, not the glyph)*
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.5c-2.4 3.3-4.5 6.3-4.5 9a4.5 4.5 0 0 0 9 0c0-2.7-2.1-5.7-4.5-9Z"/>
  <path d="M3 20.5c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0"/>
</svg>
```

**Ice Storm**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.5v19M4 7l16 10M20 7 4 17" stroke-width="1.5"/>
  <path d="M8.3 4.2 12 6.5l3.7-2.3M8.3 19.8 12 17.5l3.7 2.3" stroke-width="1.5"/>
  <path d="M2.6 9.5 6 12l-3.4 2.5M21.4 9.5 18 12l3.4 2.5" stroke-width="1.5"/>
  <circle cx="12" cy="12" r="10" stroke-width="1.5" opacity="0.55"/>
</svg>
```

**Freeze / Frost / Cold**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.5v19"/>
  <path d="M6 6l12 12M18 6 6 18"/>
  <path d="M9 4.3 12 6.3l3-2M9 19.7l3-2 3 2"/>
</svg>
```

**High Wind**  *(same wind mark as conditions section, reused — see Section 6 rule: don't
duplicate a concept with a second glyph)*

**Fire / Red Flag**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.8c2.6 3 3.8 5.4 3.8 7.6a3.8 3.8 0 0 1-7.6 0c0-.9.3-1.8.9-2.7-.2 1.7.5 2.4 1.1 2.6-.4-2.2.5-4.4 1.8-5.7Z"/>
  <path d="M8.5 14.5a5 5 0 0 0 7 6.3 4 4 0 0 0 1.8-4.7c1 .5 1.7 1.4 1.7 2.6a5.3 5.3 0 0 1-9.9 2.6 5 5 0 0 1-.6-6.8Z"/>
</svg>
```

**Hail**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M16.5 10.5a4 4 0 0 0-7.8-1.2A3.4 3.4 0 0 0 9.4 16h7.1a3.25 3.25 0 0 0 0-6.5.9.9 0 0 0-.02 1Z"/>
  <circle cx="8.5" cy="19" r="1.1" fill="currentColor" stroke="none"/>
  <circle cx="13" cy="20" r="1.1" fill="currentColor" stroke="none"/>
  <circle cx="16.5" cy="18" r="1.1" fill="currentColor" stroke="none"/>
</svg>
```

**Lightning**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 2.5 5.5 13.5H11L9.5 21.5 18.5 10H12.5L13 2.5Z" fill="currentColor" fill-opacity="0.15"/>
</svg>
```

### Storm report markers

**Wind Damage**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 21.5v-9"/>
  <path d="M12 12.5c0-4 2.5-6.5 6.5-7.5-1.5 3.5-1 6-.5 7.5"/>
  <path d="M12 16c-.5-3-2.5-4.5-5.5-5 1 2.5 1.2 4 1 5.5"/>
  <path d="M9 21.5h6"/>
</svg>
```

**Flash Flood** *(same glyph as the Flash Flood alert mark above — reused per Section 6)*

**Flood** *(same water-level glyph as the Flood alert mark above — reused)*

**Hail** *(same hail glyph as the Hail alert mark above — reused)*

**Wind Gust** *(same wind glyph as conditions — reused)*

**Lightning** *(same bolt glyph as the Lightning alert mark above — reused)*

**Generic Report**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="4" width="14" height="17" rx="2"/>
  <path d="M9 2.75h6a1 1 0 0 1 1 1V5H8v-1.25a1 1 0 0 1 1-1Z"/>
  <path d="M8.5 10.5h7M8.5 13.5h7M8.5 16.5h4.5"/>
</svg>
```

**Funnel Cloud** *(present in the report-type data but not in the brief's inventory — included
for completeness since `data/reports.js` maps `FUNNEL` to its own glyph today)*
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 4h16M6 8h12M8.5 12h7M10.5 16h3M11.5 20h1"/>
</svg>
```

**Heavy Rain** *(also present in `data/reports.js` today, not in the brief — same Rain glyph
from the conditions section, reused)*

### Moon phases (8)

**New Moon**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.06"/>
</svg>
```

**Waxing Crescent**
```html
<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="none"/>
  <path d="M13 3.3a9 9 0 0 1 0 17.4A11 11 0 0 0 13 3.3Z" stroke="none"/>
</svg>
```

**First Quarter**
```html
<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="none"/>
  <path d="M12 3a9 9 0 0 1 0 18Z" stroke="none"/>
</svg>
```

**Waxing Gibbous**
```html
<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="none"/>
  <path d="M11 3.3a11 11 0 0 1 0 17.4 9 9 0 0 0 0-17.4Z" stroke="none"/>
</svg>
```

**Full Moon**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.92"/>
</svg>
```

**Waning Gibbous**
```html
<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="none"/>
  <path d="M13 3.3a11 11 0 0 0 0 17.4 9 9 0 0 1 0-17.4Z" stroke="none"/>
</svg>
```

**Last Quarter**
```html
<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="none"/>
  <path d="M12 3a9 9 0 0 0 0 18Z" stroke="none"/>
</svg>
```

**Waning Crescent**
```html
<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="none"/>
  <path d="M11 3.3a9 9 0 0 0 0 17.4A11 11 0 0 1 11 3.3Z" stroke="none"/>
</svg>
```

*(All eight share one 24×24 circle base with a phase-terminator path filled at
`fill-opacity: 0.92` for the lit portion — consistent limb/terminator curvature across the set,
same silhouette language as every other icon in the set: circle outline + precise internal
geometry, no illustrative shading or gradient.)*

### Pollen types

**Tree**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 21.5v-7"/>
  <path d="M12 3 6 11h3.2L6.5 15.5H17.5L14.8 11H18L12 3Z"/>
</svg>
```

**Grass**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M7 21.5c0-6 1-9.5 1-14"/>
  <path d="M12 21.5c0-8 1.5-12 1.5-17.5"/>
  <path d="M17 21.5c0-5.5-1-8.5-1-13"/>
  <path d="M8 7.5C6.5 6.8 6 5.3 6.3 3.5c1.7.3 2.7 1.3 2.7 3M13.5 4C13 2.3 13.7 1 15.5 0.3c.6 1.8-.1 3-1.5 3.5M16 8.5c1.5-.5 2.3-1.8 2.2-3.5-1.7 0-2.9.9-3.2 2.5" stroke-width="1.5"/>
</svg>
```

**Weed**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 21.5V9"/>
  <path d="M12 9c-3-.5-5-2.5-5.5-6C10 3.5 12 5.5 12 9Z"/>
  <path d="M12 9c3-.5 5-2.5 5.5-6C14 3.5 12 5.5 12 9Z"/>
  <circle cx="12" cy="6" r="1" fill="currentColor" stroke="none"/>
</svg>
```

**Generic (allergen / flower)**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="2.1"/>
  <path d="M12 9.9a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM12 20.1a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM14.1 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM3.9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z"/>
</svg>
```

### Freeze markers

**Last Freeze (Spring)**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 21.5v-11"/>
  <path d="M12 10.5c-3.2-.3-5.3-2.3-6-6 3.5.7 5.5 2.7 6 6Z"/>
  <path d="M12 10.5c3.2-.3 5.3-2.3 6-6-3.5.7-5.5 2.7-6 6Z"/>
  <path d="M8.5 4 6 1.5M15.5 4 18 1.5" stroke-width="1.4"/>
</svg>
```

**First Freeze (Fall)**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.5v11.5"/>
  <path d="M12 14c-1 3-3.5 4.7-7 5 1-3.4 3.5-5 7-5Z"/>
  <path d="M12 14c1.6 2.7 4.2 4 7.5 4-1.3-3-4-4.4-7.5-4Z"/>
  <circle cx="12" cy="19.5" r="1.1" fill="currentColor" stroke="none"/>
</svg>
```

### Warning-card metadata rows

**Radar Source**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 12 4.5 8"/>
  <path d="M12 12v8.5"/>
  <path d="M8.5 20.5h7"/>
  <path d="M6.5 6.2a6.5 6.5 0 0 1 11 0"/>
  <path d="M4 4a10 10 0 0 1 16 0" opacity="0.55"/>
  <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>
</svg>
```

**Hail Size** *(same hail glyph as the alert-type Hail mark, reused per Section 6)*

**Wind Gust** *(same wind glyph as conditions, reused)*

**Storm Motion**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9"/>
  <path d="M12 12 16 8"/>
  <path d="M16 8h-3.3M16 8v3.3" stroke-width="1.5"/>
</svg>
```

**Population in Path**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <circle cx="9" cy="7.5" r="2.75"/>
  <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/>
  <circle cx="17" cy="8.5" r="2.1" opacity="0.7"/>
  <path d="M15.3 14.9c2.3.4 3.9 2.2 3.9 5" opacity="0.7"/>
</svg>
```

**Issued Time**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12.5" r="8.5"/>
  <path d="M12 7.5V12l3.2 2"/>
  <path d="M9 2.5h6" />
</svg>
```

**Magnitude**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 20 20 4"/>
  <path d="M5.5 18.5v-3M8 18.5v-2M10.5 18.5v-4M13 18.5v-2M15.5 18.5v-4M18 18.5v-2" stroke-width="1.5"/>
</svg>
```

**Issuing Office**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 21.5V9L12 4l8 5v12.5"/>
  <path d="M4 21.5h16"/>
  <path d="M9.5 21.5V15h5v6.5"/>
  <path d="M9.5 10.5h1.2M13.3 10.5h1.2" stroke-width="1.5"/>
</svg>
```

**MCD Concerning Area**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9"/>
  <circle cx="12" cy="12" r="5"/>
  <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
</svg>
```

**Watch Probability**
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 20.5V11M9.5 20.5v-6M15 20.5V7M20 20.5V3.5"/>
</svg>
```

### River gauge stage markers — proposed per-stage distinction

Today all four flood stages (`action`, `minor`, `moderate`, `major`) reuse a single 💧 glyph and
rely entirely on ring color to differentiate — genuinely a gap per the brief. Proposed fix: keep
one shared water-drop base silhouette (so the family still reads as "this is the river-gauge
icon" at a glance) but escalate an internal fill/mark per stage, so severity is legible even
if a viewer can't distinguish the ring hue (color-blind accessibility bonus, and it holds up
better when heavily downscaled or under stream compression banding):

**Low Water** *(pairs with the existing `low_threshold` stage — dry/cracked mark below waterline)*
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3c-3 4-5.5 7.5-5.5 10.5a5.5 5.5 0 0 0 11 0C17.5 10.5 15 7 12 3Z"/>
  <path d="M9.5 15.5 11 13.8l1.2 1.4 1.3-1.9" stroke-width="1.4"/>
</svg>
```

**Action Stage** *(drop, empty — baseline, no internal mark: "watching, not yet flooding")*
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3c-3 4-5.5 7.5-5.5 10.5a5.5 5.5 0 0 0 11 0C17.5 10.5 15 7 12 3Z"/>
</svg>
```

**Minor Flooding** *(drop with one internal waterline band)*
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3c-3 4-5.5 7.5-5.5 10.5a5.5 5.5 0 0 0 11 0C17.5 10.5 15 7 12 3Z"/>
  <path d="M7.2 15.5h9.6" stroke-width="1.4"/>
</svg>
```

**Moderate Flooding** *(drop, two bands, upper band filled — rising)*
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3c-3 4-5.5 7.5-5.5 10.5a5.5 5.5 0 0 0 11 0C17.5 10.5 15 7 12 3Z"/>
  <path d="M6.6 16.8h10.8M7.6 13.2h8.8" stroke-width="1.4"/>
</svg>
```

**Major Flooding** *(drop, fully filled solid + exclamation — matches the "hard attention"
visual weight of `warnFlash`-tier alerts elsewhere in the app)*
```html
<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3c-3 4-5.5 7.5-5.5 10.5a5.5 5.5 0 0 0 11 0C17.5 10.5 15 7 12 3Z" fill-opacity="0.85"/>
  <path d="M12 9v3.2" stroke="var(--bg-base, #080c14)" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="12" cy="15" r="0.9" fill="var(--bg-base, #080c14)" stroke="none"/>
</svg>
```

This gives the river-pin family a clean low→high escalation (empty → one band → two bands →
solid+alert-mark) layered on top of the existing ring-color escalation
(`#c9a227 → #ffe066 → #ffa500 → #ff3b3b → #c724ff`), so stage is legible by shape alone even
before color registers — useful given how small the river-pin glyph renders (15px) at the
overview map zoom.

---

## 12. Visual regression guardrail

The nine canonical broadcast states have deterministic 1920×1080 Playwright baselines under
`tests/visual-regression.spec.js-snapshots/`: overview, forecast, warning replay, almanac, UV,
AQI, pollen, aurora, and moon. The suite freezes the clock, waits for both self-hosted font
families, disables motion during capture, and uses `?visual-test` fixtures instead of live data.

- Run comparisons: `npm run test:visual`
- Accept intentional visual changes: `npm run test:visual:update`
- By default the suite uses installed Chrome. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to test
  another Chromium build, such as the VPS capture binary.

Never update the baselines merely to make a failure disappear. Inspect the actual/diff output
first; baseline updates belong only to reviewed, intentional changes in layout, typography,
icons, or contrast.
