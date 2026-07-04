#!/usr/bin/env bash
# One-shot VPS provisioning. Target: Debian 12 (chromium is a real .deb there;
# on Ubuntu it's a snap, which fights systemd + Xvfb). Run as root:
#   bash deploy/setup.sh
set -euo pipefail

REPO=https://github.com/zzthejimzz/arklatex-weather.git
DIR=/opt/arklatex

apt-get update
apt-get install -y --no-install-recommends \
  chromium xvfb ffmpeg nodejs npm git \
  fonts-noto-core fonts-noto-color-emoji fonts-inter

id -u arklatex &>/dev/null || useradd -r -m -d /var/lib/arklatex -s /usr/sbin/nologin arklatex

if [[ -d $DIR/.git ]]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi

cd "$DIR"
npm ci
npm run build

chmod +x deploy/stream.sh deploy/watchdog.sh
chown -R arklatex:arklatex "$DIR"

# Env template — fill in the stream key + music path, then start the units.
if [[ ! -f /etc/arklatex.env ]]; then
  cat > /etc/arklatex.env <<'EOF'
YOUTUBE_STREAM_KEY=paste-key-from-youtube-studio
MUSIC_FILE=/var/lib/arklatex/music/loop.mp3
EOF
  chmod 600 /etc/arklatex.env
  mkdir -p /var/lib/arklatex/music
  chown -R arklatex:arklatex /var/lib/arklatex
  echo ">>> edit /etc/arklatex.env and drop your music loop in /var/lib/arklatex/music/"
fi

cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable arklatex-serve.service arklatex-stream.service arklatex-watchdog.timer

echo ">>> when /etc/arklatex.env is filled in:  systemctl start arklatex-serve arklatex-stream arklatex-watchdog.timer"
