# Live traffic cam research (Phase 2, researched 2026-07-04)

Goal: LIVE video feeds (not snapshots) from state DOT cameras in the SHV CWA,
legally restreamable on a — eventually monetized — 24/7 YouTube channel.

## State-by-state

### Arkansas (ARDOT / iDriveArkansas) — clearest terms, best candidate
Published camera terms of use
(<https://site.idrivearkansas.com/index.php/policies/camera-terms-of-use>):

- ✅ "Display of any camera image from IDrive Arkansas over broadcast /
  streaming media is allowed…"
- ⚠️ "…however advertising or sponsorships in association with the display of
  these images are strictly prohibited and will be enforced." No ads on
  screen at the same time as cam video. **A monetized YouTube stream with
  mid-rolls likely violates this while cams are on screen.**
- ⚠️ "Broadcast / streaming media are to make verbal reference to the LIVE
  traffic cameras on IDrive Arkansas" — we have no voice track until Phase 4
  TTS; whether an on-screen credit satisfies this needs ARDOT's sign-off.
- ❌ Embedding cams in another website/app is prohibited (our headless-browser
  page is arguably an "app"; the allowed category is broadcast/streaming
  display — get written confirmation that a 24/7 YouTube weather stream
  qualifies).
- Contact: ARDOT Public Information Office (they also provide the IDrive
  logo and "assistance in developing a custom solution").
- SW Arkansas coverage (Texarkana, Hope, De Queen area) exists but is
  thinner than the I-30 corridor.

### Louisiana (DOTD / 511la.org) — streams exist, terms unpublished
- Live **HLS** streams are real: the cameras API returns
  `VideoUrl: https://ITSStreamingBR2.dotd.la.gov/public/shr-cam-030.streams/playlist.m3u8`
  (that sample is literally a Shreveport cam) —
  <https://www.511la.org/help/endpoint/cameras>.
- API requires a developer key; no published process — request via DOTD
  contact (<https://dotd.la.gov/contact-us/>). No published rebroadcast
  terms anywhere on 511la.org; permission must be asked in writing.

### Texas (TxDOT / DriveTexas) — mostly snapshots
- Public cameras are snapshot images that refresh periodically, not
  continuous streams (<https://www.txdot.gov/discover/live-traffic-cameras.html>).
  Some district ITS sites (its.txdot.gov) expose streaming players, but
  NE Texas coverage and a rebroadcast policy are unconfirmed. TV stations
  use TxDOT feeds under agreements — ask TxDOT media relations (Atlanta
  and Tyler districts cover our counties).

### Oklahoma (ODOT / oktraffic.org) — low priority
- Live video exists (<https://www.oktraffic.org/rwis_stations.php>) but
  terms unpublished, and SE Oklahoma (McCurtain/Idabel) has essentially no
  ITS camera density. Not worth chasing for launch.

## Bottom line

No state offers keyless, unconditionally-restreamable live cams. The path
is written permission:

1. **Email ARDOT PIO** — confirm a 24/7 YouTube weather stream counts as
   "broadcast/streaming media," ask how attribution should work pre-TTS,
   and how their no-ads rule interacts with YouTube monetization
   (e.g. cams only during ad-free segments).
2. **Email LA DOTD / 511LA** — request a developer key + written
   permission to restream the HLS cams (Shreveport metro is the crown
   jewel for our region).
3. **Email TxDOT** (Atlanta/Tyler districts) — ask whether live streams
   (not snapshots) are available to media partners and on what terms.
4. Skip ODOT for now.

Until permissions land, cams stay out of the broadcast (Phase 4 anyway).
Design note for later: cam windows must be droppable per-state at runtime
so a revoked permission never takes the stream down.
