#!/usr/bin/env bash
#
# Pull-based auto-deploy for the VM: if origin/main has new commits, pull them
# and run setup.sh. Meant for cron (see DEPLOY.md), needs no GitHub secrets.
#     */5 * * * * bash ~/gym-bot/deploy/auto-update.sh >> ~/gym-bot-deploy.log 2>&1

set -euo pipefail

# cron starts with a minimal PATH; pm2 and global npm bins live in /usr/local/bin.
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

cd "$(dirname "$0")/.."

# Skip if the previous deploy is still running.
exec 9>/tmp/gym-bot-deploy.lock
flock -n 9 || exit 0

git fetch -q origin main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  exit 0
fi

echo "==> $(date -Is) deploying $(git rev-parse --short origin/main)"
# npm на VM може переписати lock-файли — повертаємо їх, інакше pull відмовиться оновлювати.
git checkout -- package-lock.json webapp/package-lock.json 2>/dev/null || true
git pull -q --ff-only origin main
bash deploy/setup.sh
echo "==> $(date -Is) deploy finished"
