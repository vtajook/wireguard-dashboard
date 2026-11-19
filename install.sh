#!/usr/bin/env bash
# WireGuard Dashboard — one-shot installer (Ubuntu / Debian, run as root)
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/vtajook/wireguard-dashboard/main/install.sh)
#
# Options (environment variables):
#   PANEL_PORT=5081      port of the web panel (HTTP; turn on HTTPS later in Settings)
#   PANEL_DIR=/opt/WG_Panel
#   BRANCH=main
#
# A fresh install: installs packages, clones the panel, creates the Python
# venv, writes .env (random keys), instance/runtime.json and the wg-panel
# systemd service, enables IP forwarding and starts the panel.
# Running it again on an existing install only updates the code and
# dependencies and restarts the panel; .env, the database and WireGuard
# configs are kept. (Normal updates: Update Center inside the panel.)
set -euo pipefail

REPO_URL="https://github.com/vtajook/wireguard-dashboard.git"
PANEL_DIR="${PANEL_DIR:-/opt/WG_Panel}"
PANEL_PORT="${PANEL_PORT:-5081}"
BRANCH="${BRANCH:-main}"
SERVICE=wg-panel

green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
red() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { red "Run as root (sudo -i)."; exit 1; }
command -v apt-get >/dev/null || { red "Only Ubuntu / Debian (apt) is supported."; exit 1; }
case "$PANEL_PORT" in ''|*[!0-9]*) red "PANEL_PORT must be a number"; exit 1;; esac

green "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt-get update -y
apt-get install -y git curl ca-certificates python3 python3-venv python3-pip \
  wireguard wireguard-tools iptables iproute2 sqlite3 ethtool rsync unzip

FRESH=0
if [ -f "$PANEL_DIR/app.py" ]; then
  green "==> Existing panel found in $PANEL_DIR — updating code"
  if [ -d "$PANEL_DIR/.git" ]; then
    # an older install may still point at another repository
    git -C "$PANEL_DIR" remote set-url origin "$REPO_URL" 2>/dev/null \
      || git -C "$PANEL_DIR" remote add origin "$REPO_URL"
    git -C "$PANEL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$PANEL_DIR" reset --hard "origin/$BRANCH"
  else
    TMP="$(mktemp -d)"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TMP/src"
    rsync -a \
      --exclude '.git/' --exclude 'venv/' --exclude '__pycache__/' --exclude 'instance/' \
      --exclude '.env' --exclude 'backups/' --exclude 'restore_snapshots/' \
      "$TMP/src/" "$PANEL_DIR/"
    rm -rf "$TMP"
  fi
else
  FRESH=1
  green "==> Downloading the panel into $PANEL_DIR"
  mkdir -p "$(dirname "$PANEL_DIR")"
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$PANEL_DIR"
fi

cd "$PANEL_DIR"
mkdir -p instance /etc/wireguard
chmod 700 /etc/wireguard

green "==> Python environment"
[ -x venv/bin/python ] || python3 -m venv venv
venv/bin/pip install --upgrade pip wheel >/dev/null
venv/bin/pip install -r requirements.txt

if [ ! -f .env ]; then
  green "==> Writing .env (random keys)"
  SECRET=$(venv/bin/python -c 'import secrets;print(secrets.token_hex(32))')
  FERNET=$(venv/bin/python -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())')
  APIKEY=$(venv/bin/python -c 'import secrets;print(secrets.token_urlsafe(32))')
  SETUP=$(venv/bin/python -c 'import secrets;print(secrets.token_urlsafe(12))')
  cat > .env <<EOF
FLASK_SECRET_KEY=$SECRET
FERNET_KEY=$FERNET
API_KEY=$APIKEY
DATABASE_URL=sqlite:///instance/wg_panel.db

LOG_LEVEL=INFO
SECURE_COOKIES=0
WIREGUARD_CONF_PATH=/etc/wireguard

# Live peer detection
WG_ONLINE_PROBE_FIRST=1
WG_ONLINE_HANDSHAKE_FALLBACK=0
WG_ONLINE_HANDSHAKE_WINDOW=45

SETUP_TOKEN=$SETUP
TG_HEARTBEAT_SEC=60
EOF
fi
chmod 600 .env

if [ ! -f instance/runtime.json ]; then
  printf '{"bind": "0.0.0.0:%s", "port": %s, "workers": 0, "threads": 4, "timeout": 60, "graceful_timeout": 30, "loglevel": "info"}\n' \
    "$PANEL_PORT" "$PANEL_PORT" > instance/runtime.json
fi
if [ ! -f instance/panel_settings.json ]; then
  printf '{"tls_enabled": false, "domain": "", "http_port": %s, "https_port": 443, "force_https_redirect": false, "hsts": false, "tls_cert_path": "", "tls_key_path": ""}\n' \
    "$PANEL_PORT" > instance/panel_settings.json
fi

green "==> IP forwarding"
cat > /etc/sysctl.d/99-wg-panel.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
sysctl -q -p /etc/sysctl.d/99-wg-panel.conf || true

green "==> systemd service ($SERVICE)"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=WireGuard Dashboard (app.py launcher)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PANEL_DIR
EnvironmentFile=$PANEL_DIR/.env
ExecStart=$PANEL_DIR/venv/bin/python $PANEL_DIR/app.py
Restart=always
RestartSec=2
User=root
Group=root
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"

sleep 4
if systemctl is-active --quiet "$SERVICE"; then
  green "==> Panel is running"
else
  red "Panel did not start. Log: journalctl -u $SERVICE -n 50 --no-pager"
  exit 1
fi

IP=$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
PORT_NOW=$(venv/bin/python -c 'import json;r=json.load(open("instance/runtime.json"));print((r.get("bind") or "").rsplit(":",1)[-1] or r.get("port") or "")' 2>/dev/null || echo "$PANEL_PORT")
echo
if [ "$FRESH" = 1 ]; then
  green "Open:   http://$IP:$PORT_NOW/register   (create the first admin)"
  yellow "Setup token (asked on the register page): $(grep '^SETUP_TOKEN=' .env | cut -d= -f2-)"
  echo "Then: create a WireGuard interface (Peers → New interface) and set its"
  echo "client endpoint (Settings → Interface → Client endpoint host + Save endpoint)."
  echo "HTTPS / domain: Settings → Panel."
else
  green "Updated. Panel: http://$IP:$PORT_NOW  (or your HTTPS domain)"
fi
