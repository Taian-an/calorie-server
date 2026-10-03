#!/bin/bash
# deploy.sh — 把 server/ 部署到 VPS，重啟 PM2；加 --with-web 順便重新 build 並上傳 calorie-app 網頁版
#
# 用法：
#   ./deploy.sh              只部署後端（最常用，改完 server/ 程式碼後跑這個）
#   ./deploy.sh --with-web   後端 + 網頁版一起部署（改到 calorie-app/ 的東西才需要）
#
set -euo pipefail

# --- 設定 ---
VM_USER="azureuser"
VM_HOST="20.46.181.25" # 2026-09 從香港(East Asia)搬到日本東部(Japan East)：Google Gemini API 不支援香港地區存取
PROD_DOMAIN="app.calorietracks.com" # 2026-10 起的正式網域；舊的 20-46-181-25.nip.io 仍保留 /api 給已安裝的舊版 App
PROD_API_URL="https://$PROD_DOMAIN/api"
BACKEND_REMOTE="/var/www/calorie-backend"
APP_REMOTE="/var/www/calorie-app"
PM2_APP_NAME="calorie-backend"

# 這支腳本放在 calorie-server repo 的 ops/ 底下（SP/server/ops/deploy.sh），SP/deploy.sh 是指向它的捷徑。
# 用 readlink -f 解析捷徑拿到真正位置，再往上找 SP 根目錄——金鑰、calorie-app 都在 SP 底下，不在 repo 裡
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
SP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
KEY_PATH="$SP_ROOT/AI-calorie-server_key.pem"
BACKEND_LOCAL="$SP_ROOT/server"
APP_LOCAL="$SP_ROOT/calorie-app"

SSH="ssh -i $KEY_PATH -o ConnectTimeout=10"
RSYNC_SSH="ssh -i $KEY_PATH"

DEPLOY_WEB=false
if [[ "${1:-}" == "--with-web" ]]; then
  DEPLOY_WEB=true
elif [[ "${1:-}" != "" ]]; then
  echo "未知參數：$1（只支援 --with-web）" >&2
  exit 1
fi

chmod 400 "$KEY_PATH"

echo "==> 檢查連線到 $VM_USER@$VM_HOST"
if ! $SSH "$VM_USER@$VM_HOST" "echo ok" >/dev/null 2>&1; then
  echo "SSH 連不上。常見原因：" >&2
  echo "  1. VM 是關著的 — 去 Azure Portal 開機（開機後可能會換一個新的 public IP，要記得更新這支腳本裡的 VM_HOST）" >&2
  echo "  2. Network Security Group 沒開 port 22" >&2
  exit 1
fi

echo "==> 部署後端到 $BACKEND_REMOTE"
rsync -avz --delete \
  -e "$RSYNC_SSH" \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.gitignore' \
  --exclude '.git' \
  --exclude 'ops' \
  --exclude 'CLAUDE.md' \
  "$BACKEND_LOCAL/" \
  "$VM_USER@$VM_HOST:$BACKEND_REMOTE/"

echo "==> npm install + 重啟 PM2"
# npm install 加 5 分鐘上限：2026-10 曾經在 VM 上卡住 3 個多小時，後面的 pm2 restart 一直沒執行（新程式碼沒上線）。
# 逾時的話這裡會失敗並中止部署，訊息會提示手動重啟；--no-audit/--no-fund 省掉跟部署無關的網路請求
$SSH "$VM_USER@$VM_HOST" "cd $BACKEND_REMOTE && timeout 300 npm install --no-audit --no-fund && pm2 restart $PM2_APP_NAME" || {
  echo "npm install 失敗或超過 5 分鐘。程式碼已上傳；沒有新增套件的話，可以直接重啟：" >&2
  echo "  ssh -i $KEY_PATH $VM_USER@$VM_HOST 'pm2 restart $PM2_APP_NAME'" >&2
  exit 1
}

echo "==> 後端部署完成"

if [ "$DEPLOY_WEB" = true ]; then
  echo "==> 重新 build App 網頁版（暫時切到正式環境 API URL）"

  ENV_FILE="$APP_LOCAL/.env.local"
  ENV_BACKUP=$(mktemp)
  cp "$ENV_FILE" "$ENV_BACKUP"

  # 不管打包成功或失敗，結束前一定要把 .env.local 換回原本的本機開發設定
  restore_env() {
    cp "$ENV_BACKUP" "$ENV_FILE"
    rm -f "$ENV_BACKUP"
  }
  trap restore_env EXIT

  # 只覆蓋 API 網址那一行，其他變數（例如 Google 登入的 Client ID）原封不動保留——
  # 之前這裡是整份蓋掉，導致正式站 build 出來的網頁版漏了 Google Client ID，Google 登入按鈕整個不會顯示
  awk -v url="EXPO_PUBLIC_API_URL=$PROD_API_URL" '
    /^EXPO_PUBLIC_API_URL=/ { print url; done=1; next }
    { print }
    END { if (!done) print url }
  ' "$ENV_BACKUP" > "$ENV_FILE"
  # --clear 一定要加：Metro 的 transform cache 是用原始碼內容當 key，不會因為 .env.local 換了值就自動失效，
  # 沒加這個 flag 的話環境變數換了、程式碼沒改，打包出來的還是上一次快取住的舊值（親身踩過這個坑）
  (cd "$APP_LOCAL" && npx expo export -p web --clear)

  # 分頁小圖示：瀏覽器會把 favicon 快取很久，換了 icon 使用者還是看到舊圖——
  # 網址加上內容雜湊當版本號，圖一換網址就變，瀏覽器一定重抓。
  # 順便補 apple-touch-icon（iPhone「加入主畫面」和部分分享預覽用的圖示）
  python3 - "$APP_LOCAL" <<'PY'
import hashlib, sys
from PIL import Image
app = sys.argv[1]
Image.open(f'{app}/assets/icon.png').convert('RGB').resize((180, 180), Image.LANCZOS).save(f'{app}/dist/apple-touch-icon.png')
ver = hashlib.md5(open(f'{app}/dist/favicon.ico', 'rb').read()).hexdigest()[:8]
p = f'{app}/dist/index.html'
html = open(p).read().replace('href="/favicon.ico"', f'href="/favicon.ico?v={ver}"')
html = html.replace('</head>', f'<link rel="apple-touch-icon" href="/apple-touch-icon.png?v={ver}" /></head>', 1)
open(p, 'w').write(html)
PY

  trap - EXIT
  restore_env

  echo "==> 上傳新 build（先傳到暫存路徑，用 mv 原子性換上去，舊版留一份 .bak 方便回滾）"
  $SSH "$VM_USER@$VM_HOST" "rm -rf /tmp/calorie-app-new"
  rsync -avz --delete \
    -e "$RSYNC_SSH" \
    "$APP_LOCAL/dist/" \
    "$VM_USER@$VM_HOST:/tmp/calorie-app-new/"

  $SSH "$VM_USER@$VM_HOST" "
    sudo rm -rf ${APP_REMOTE}.bak &&
    sudo mv $APP_REMOTE ${APP_REMOTE}.bak &&
    sudo mv /tmp/calorie-app-new $APP_REMOTE &&
    sudo chown -R www-data:www-data $APP_REMOTE
  "

  echo "==> App 網頁版部署完成"
fi

echo "==> 驗證"
$SSH "$VM_USER@$VM_HOST" "pm2 list"
curl -s -o /dev/null -w "  $PROD_API_URL/health -> HTTP %{http_code}\n" "$PROD_API_URL/health"

echo "==> 全部完成"
