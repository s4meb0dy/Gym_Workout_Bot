#!/usr/bin/env bash
#
# Gym Telegram Bot — one-shot setup for an Ubuntu VM (Oracle Cloud Always Free, etc.)
# Run from the project root on the VM:
#     bash deploy/setup.sh
#
# Idempotent: safe to re-run after `git pull` to redeploy.

set -euo pipefail

APP_NAME="gym-bot"
NODE_MAJOR=22

cd "$(dirname "$0")/.."   # move to project root regardless of where it's called from
PROJECT_DIR="$(pwd)"
echo "==> Project directory: ${PROJECT_DIR}"

# --- Swap (helps on 1GB micro instances during build) -------------------
total_mem_kb="$(grep MemTotal /proc/meminfo | awk '{print $2}')"
swap_kb="$(grep SwapTotal /proc/meminfo | awk '{print $2}')"
if [ "${total_mem_kb}" -lt 2097152 ] && [ "${swap_kb}" -lt 1048576 ]; then
  if [ ! -f /swapfile ]; then
    echo "==> Low RAM detected ($(( total_mem_kb / 1024 )) MB). Creating 2GB swap file"
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    if ! grep -q '/swapfile' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    fi
    echo "==> Swap enabled:"
    free -h | grep -i swap || true
  fi
fi

echo "==> Updating system packages"
sudo apt-get update -y

echo "==> Installing prerequisites (curl, git, ca-certificates)"
sudo apt-get install -y curl ca-certificates git

# --- Node.js -------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  current_major="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "${current_major}" -ge "${NODE_MAJOR}" ]; then
    need_node=0
    echo "==> Node.js already present: $(node -v)"
  fi
fi

if [ "${need_node}" -eq 1 ]; then
  echo "==> Installing Node.js ${NODE_MAJOR}.x (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Node: $(node -v) | npm: $(npm -v)"

# --- Environment file ----------------------------------------------------
if [ ! -f .env ]; then
  echo ""
  echo "!! .env NOT found in ${PROJECT_DIR}"
  echo "!! Create it before the bot can start:"
  echo "!!     cp .env.example .env && nano .env"
  echo "!! Required: BOT_TOKEN, GEMINI_API_KEY"
  echo ""
  read -r -p "Press Enter once .env is ready (or Ctrl+C to abort)... " _
fi

# --- Build & DB ----------------------------------------------------------
echo "==> Installing dependencies"
npm install

echo "==> Building TypeScript -> dist/"
npm run build

echo "==> Database migrate + seed"
npm run db:setup

# --- Process manager (pm2) ----------------------------------------------
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing pm2 globally"
  sudo npm install -g pm2
fi

# --- Cloudflare quick tunnel (HTTPS for the Telegram Mini App) ----------
# Gives https://*.trycloudflare.com without opening ports. The bot reads the
# current hostname from cloudflared metrics and updates its menu button.
# With a permanent WEBAPP_URL in .env (e.g. Caddy, see DEPLOY.md) the tunnel
# is not needed and gets stopped.
TUNNEL_NAME="gym-tunnel"
TUNNEL_METRICS="127.0.0.1:20241"

if grep -q '^WEBAPP_URL=.\+' .env; then
  if pm2 describe "${TUNNEL_NAME}" >/dev/null 2>&1; then
    echo "==> WEBAPP_URL is set — removing the temporary Cloudflare tunnel"
    pm2 delete "${TUNNEL_NAME}" >/dev/null
  fi
else

if ! command -v cloudflared >/dev/null 2>&1; then
  case "$(uname -m)" in
    aarch64|arm64) cf_arch="arm64" ;;
    *) cf_arch="amd64" ;;
  esac
  echo "==> Installing cloudflared (${cf_arch})"
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}.deb"
  sudo dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
fi

if ! grep -q '^TUNNEL_METRICS_URL=' .env && ! grep -q '^WEBAPP_URL=' .env; then
  echo "TUNNEL_METRICS_URL=http://${TUNNEL_METRICS}" >> .env
fi

# Restarting the tunnel changes its address, so leave a running one alone.
if ! pm2 describe "${TUNNEL_NAME}" >/dev/null 2>&1; then
  echo "==> Starting Cloudflare tunnel under pm2 as '${TUNNEL_NAME}'"
  pm2 start cloudflared --name "${TUNNEL_NAME}" --time -- \
    tunnel --no-autoupdate --metrics "${TUNNEL_METRICS}" --url "http://localhost:3000"
fi

fi

# The bot starts after .env has the tunnel settings.
echo "==> (Re)starting bot under pm2 as '${APP_NAME}'"
pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
pm2 start dist/index.js --name "${APP_NAME}" --time
pm2 save

echo "==> Enabling pm2 startup on reboot"
startup_cmd="$(pm2 startup systemd -u "${USER:-$(id -un)}" --hp "$HOME" | grep -E '^sudo ' || true)"
if [ -n "${startup_cmd}" ]; then
  eval "${startup_cmd}"
  pm2 save
fi

echo ""
echo "============================================================"
echo " Done! The bot is running and will auto-start on reboot."
echo ""
echo " Useful commands:"
echo "   pm2 status              # process status"
echo "   pm2 logs ${APP_NAME}        # live logs"
echo "   pm2 restart ${APP_NAME}     # restart"
echo "   pm2 stop ${APP_NAME}        # stop"
echo ""
echo " To redeploy after code changes:"
echo "   git pull && bash deploy/setup.sh"
echo "============================================================"
