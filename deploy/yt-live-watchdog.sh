#!/usr/bin/env bash
# YouTube-liveness watchdog, run every 3 minutes by arklatex-yt-live-watchdog.timer.
#
# systemd Restart= catches a dead process; watchdog.sh catches a wedged renderer
# (two identical frame grabs). Neither catches the failure seen 2026-08-03: the
# renderer was animating, ffmpeg was pushing a healthy 6 Mbps, TCP/1935 was
# ESTABLISHED and bytes were flowing -- yet YouTube's broadcast was orphaned and
# the channel sat on "Preparing stream" indefinitely. Every box-local signal
# looked fine, so the only authority on "are we actually live" is YouTube itself.
#
# This probes the public /live page and, ONLY after several unambiguous "not
# live" reads, restarts the stream to force a fresh RTMP session (the manual fix
# that worked). Guardrails (streak threshold, cooldown, hourly cap, treating any
# unreachable/bot-blocked probe as inconclusive) keep it from ever bouncing a
# stream that is actually healthy.
#
# 2026-08-13: YouTube began intermittently serving this datacenter IP a bot wall
# ("Sign in to confirm you're not a bot" / playabilityStatus LOGIN_REQUIRED).
# That page STILL embeds ytInitialPlayerResponse, so the marker guard below
# passed it as a real channel page; it just lacked "isLive":true, so every
# challenge got miscounted as "not live" and the watchdog bounced a perfectly
# healthy stream every cooldown window (3 needless restarts, 07:16/07:31/07:46) --
# and each restart was what actually dropped the channel to "Preparing stream".
# Fix: detect the login/consent/anti-abuse interstitial explicitly and treat it
# as inconclusive, BEFORE the isLive check, so a gated page can neither be read
# as "not live" nor be trusted for a stray embedded "isLive":true.
#
# 2026-09-02: a genuine ffmpeg RTMP drop (broken pipe) orphaned the broadcast,
# and this watchdog correctly saw "not live" -- but its only tool, a quick
# `systemctl restart`, came back "Preparing stream" every time (03:51/04:06/04:21),
# burned the hourly restart cap, and then just emailed CRITICAL and gave up.
# Manual cold-stop (stop, wait 3min, start) fixed it on the first try, same as
# the 2026-08-03 incident this watchdog was built for. Quick restart has a 0/5
# track record against orphaned "Preparing stream" across both incidents -- it
# only clears a dead-process-style failure, not this one. So once the quick-
# restart cap is exhausted, escalate automatically to cold-stop-wait-restart
# (see the ESCALATION_* block below) instead of just alerting and stopping.
set -euo pipefail

CHANNEL_URL="https://www.youtube.com/@ArkLaTexWeather/live"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

FAILS_FILE=/run/arklatex-ytlive.fails       # consecutive clear "not live" reads
RESTARTS_FILE=/run/arklatex-ytlive.restarts # epoch timestamp per auto-restart
FAIL_THRESHOLD=3    # consecutive "not live" reads before acting (~9 min @ 3-min cadence)
COOLDOWN=900        # seconds to wait after a restart before another (15 min)
MAX_PER_HOUR=3      # hard cap on quick auto-restarts within a rolling hour
ENV_FILE=/etc/arklatex/healthcheck.env      # reuse the healthcheck Gmail relay

# Escalation tier: once quick restarts are exhausted (MAX_PER_HOUR reached) and
# the channel is still not live, try a cold-stop-wait-restart instead of just
# alerting. Rate-limited separately and more conservatively than quick restarts
# since it takes the stream fully down for COLD_STOP_WAIT seconds -- a real
# prolonged outage should still page a human rather than cold-cycle forever.
ESCALATIONS_FILE=/run/arklatex-ytlive.escalations # epoch timestamp per escalation
COLD_STOP_WAIT=180        # seconds to sit stopped before restarting (3 min; 10s was proven not enough)
ESCALATION_COOLDOWN=1200  # seconds between escalations (20 min)
MAX_ESCALATIONS_PER_HOUR=2
POST_ESCALATION_PROBE_WAIT=90 # seconds to wait before re-probing to confirm recovery

log() { echo "yt-live-watchdog: $*"; }

# Email via the same Gmail SMTP relay the healthcheck uses. Best-effort: a failed
# send must never abort the watchdog.
notify() {
  local subject="$1"
  [ -f "$ENV_FILE" ] || return 0
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  [ -n "${GMAIL_USER:-}" ] && [ -n "${GMAIL_APP_PASSWORD:-}" ] && [ -n "${MAIL_TO:-}" ] || return 0
  local msg; msg=$(mktemp)
  {
    echo "From: ArkLaTex Monitor <$GMAIL_USER>"
    echo "To: $MAIL_TO"
    echo "Subject: $subject"
    echo "Date: $(date -R)"
    echo "Content-Type: text/plain; charset=UTF-8"
    echo
    echo "$subject"
    echo
    echo "Host: $(hostname)   Time: $(date -R)"
    echo "Probe: $CHANNEL_URL"
  } > "$msg"
  curl -fsS -m 30 --ssl-reqd --url 'smtps://smtp.gmail.com:465' \
    --mail-from "$GMAIL_USER" --mail-rcpt "$MAIL_TO" \
    --user "$GMAIL_USER:$GMAIL_APP_PASSWORD" \
    --upload-file "$msg" >/dev/null 2>&1 \
    && log "alert emailed: $subject" || log "alert email FAILED: $subject"
  rm -f "$msg"
}

# --- probe -----------------------------------------------------------------
html=$(curl -sS -A "$UA" -H "Accept-Language: en-US,en;q=0.9" \
         --cookie "CONSENT=YES+1" -m 20 -L "$CHANNEL_URL" 2>/dev/null) || {
  log "probe failed (curl/network error) -- inconclusive, no action"
  exit 0
}

# A bot-block / consent / challenge page returns HTTP 200 but is not the channel
# page. Require a marker that only the real watch/channel page carries, so such a
# response is treated as inconclusive -- never mistaken for "not live".
if ! grep -q "ytInitialPlayerResponse" <<<"$html"; then
  log "probe returned a non-channel page (bot/consent?) -- inconclusive, no action"
  exit 0
fi

# A login/consent/anti-abuse interstitial DOES still embed ytInitialPlayerResponse,
# so it slips past the marker guard above. It carries a LOGIN_REQUIRED playability
# status or the "not a bot" challenge text and cannot report our real live state --
# treat it as inconclusive. Checked BEFORE isLive so a stray embedded "isLive":true
# on such a page can't produce a false positive either.
if grep -qE 'LOGIN_REQUIRED|Sign in to confirm you|consent\.youtube\.com|/sorry/' <<<"$html"; then
  log "probe hit a login/consent/anti-abuse interstitial (IP flagged as bot) -- inconclusive, no action"
  exit 0
fi

if grep -q '"isLive":true' <<<"$html"; then
  [ -f "$FAILS_FILE" ] && rm -f "$FAILS_FILE"   # healthy: clear the streak
  log "channel is live -- ok"
  exit 0
fi

# --- clear "not live": count it --------------------------------------------
fails=$(( $(cat "$FAILS_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$FAILS_FILE"
log "channel NOT live -- consecutive=$fails/$FAIL_THRESHOLD"
[ "$fails" -ge "$FAIL_THRESHOLD" ] || exit 0

# --- guardrails before restarting ------------------------------------------
now=$(date +%s)

last=$(tail -n1 "$RESTARTS_FILE" 2>/dev/null || echo 0)
if [ "$((now - last))" -lt "$COOLDOWN" ]; then
  log "within cooldown ($((now - last))s < ${COOLDOWN}s since last restart) -- waiting"
  exit 0
fi

# Rolling-hour cap: keep only restarts from the last hour, then count them.
recent=$(awk -v cutoff=$((now - 3600)) '$1 >= cutoff' "$RESTARTS_FILE" 2>/dev/null || true)
count=$(printf '%s\n' "$recent" | grep -c . || true)
if [ "$count" -ge "$MAX_PER_HOUR" ]; then
  # Quick restarts are exhausted. A quick `systemctl restart` has never once
  # cleared a truly orphaned "Preparing stream" broadcast (2026-08-03, 2026-09-02)
  # -- only a cold stop with a multi-minute gap has. Escalate to that, gated by
  # its own separate cooldown/cap so a genuine prolonged outage still pages a
  # human instead of cold-cycling the stream indefinitely.
  last_escalation=$(tail -n1 "$ESCALATIONS_FILE" 2>/dev/null || echo 0)
  recent_esc=$(awk -v cutoff=$((now - 3600)) '$1 >= cutoff' "$ESCALATIONS_FILE" 2>/dev/null || true)
  esc_count=$(printf '%s\n' "$recent_esc" | grep -c . || true)

  if [ "$((now - last_escalation))" -lt "$ESCALATION_COOLDOWN" ]; then
    log "restart cap reached ($count in last hour); escalation on cooldown ($((now - last_escalation))s < ${ESCALATION_COOLDOWN}s) -- NOT restarting; needs manual attention"
    notify "[ArkLaTex CRITICAL] stream STILL not live after ${MAX_PER_HOUR} auto-restarts in the last hour -- MANUAL ATTENTION NEEDED"
    exit 0
  fi

  if [ "$esc_count" -ge "$MAX_ESCALATIONS_PER_HOUR" ]; then
    log "restart cap reached ($count in last hour); escalation cap also reached ($esc_count in last hour) -- NOT restarting; needs manual attention"
    notify "[ArkLaTex CRITICAL] stream STILL not live after repeated auto-restarts and a cold-restart escalation -- MANUAL ATTENTION NEEDED"
    exit 0
  fi

  log "restart cap reached ($count in last hour) -- escalating to cold-stop-wait-restart"
  notify "[ArkLaTex WARNING] quick restarts exhausted -- escalating to a cold stop (~${COLD_STOP_WAIT}s down) to clear an orphaned broadcast"
  { printf '%s\n' "$recent_esc"; echo "$now"; } | grep -v '^$' > "$ESCALATIONS_FILE"
  { printf '%s\n' "$recent"; echo "$now"; } | grep -v '^$' > "$RESTARTS_FILE"
  rm -f "$FAILS_FILE"

  systemctl stop arklatex-stream.service
  sleep "$COLD_STOP_WAIT"
  systemctl start arklatex-stream.service
  sleep "$POST_ESCALATION_PROBE_WAIT"

  recheck=$(curl -sS -A "$UA" -H "Accept-Language: en-US,en;q=0.9" \
              --cookie "CONSENT=YES+1" -m 20 -L "$CHANNEL_URL" 2>/dev/null || true)
  if grep -q '"isLive":true' <<<"$recheck"; then
    log "cold-stop-wait-restart recovered the stream"
    notify "[ArkLaTex RECOVERED] cold-restart escalation cleared the orphaned broadcast -- channel is live again"
  else
    log "cold-stop-wait-restart did NOT bring the channel back live"
    notify "[ArkLaTex CRITICAL] cold-restart escalation did not bring the channel back live -- MANUAL ATTENTION NEEDED"
  fi
  exit 0
fi

# --- restart: force a fresh RTMP session -----------------------------------
log "restarting arklatex-stream (fails=$fails, restarts_last_hour=$count)"
{ printf '%s\n' "$recent"; echo "$now"; } | grep -v '^$' > "$RESTARTS_FILE"
rm -f "$FAILS_FILE"
systemctl restart arklatex-stream.service
notify "[ArkLaTex WARNING] stream auto-restarted -- YouTube showed NOT live for ${FAIL_THRESHOLD} consecutive checks. Fresh RTMP session forced; should be back within ~30s."
