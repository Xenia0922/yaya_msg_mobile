#!/usr/bin/env bash
# 成员库镜像中继（境内机版本）
# ---------------------------------------------------------------------------
# 为什么需要它：
#   GitHub Actions（Azure 出口 IP）请求 https://data.gnz.hk/members.json 恒返回 403
#   （Cloudflare 按 IP/机房段拦，加 Referer/浏览器 UA 无效，见 2026-09-27 日志）。
#   本机（境内）可正常 200，因此改由本机拉上游 → 生成 dist → 提交回 GitHub main
#   → 清 jsDelivr 缓存。App 端无需改动即可自动拿到最新成员库。
#
# 部署位置：/root/member_db_relay/run.sh（阿里云 8.163.75.157）
# crontab：0 * * * * /root/member_db_relay/run.sh >> /root/member_db_relay/cron.log 2>&1
# 依赖：node >= 18（apt install nodejs）、git、curl
# 推送凭据：/root/.ssh/member_db_relay_ed25519（仓库 Deploy key，read/write）
set -uo pipefail

BASE="/root/member_db_relay"
REPO_DIR="$BASE/repo"
LOG="$BASE/relay.log"
KEY="/root/.ssh/member_db_relay_ed25519"
REMOTE="git@github.com:Xenia0922/yaya_msg_mobile.git"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG"; }

export GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

mkdir -p "$BASE"

# 1) 首次克隆（稀疏：只要 member-db 目录，避免拉整个仓库）
if [ ! -d "$REPO_DIR/.git" ]; then
  log "首次克隆（sparse: member-db）"
  git clone --depth 1 --filter=blob:none --sparse -b main "$REMOTE" "$REPO_DIR" >>"$LOG" 2>&1 \
    || { log "克隆失败"; exit 1; }
  git -C "$REPO_DIR" sparse-checkout set member-db >>"$LOG" 2>&1
fi

cd "$REPO_DIR" || exit 1

# 2) 对齐远端 main
git fetch --depth 1 -q origin main >>"$LOG" 2>&1 || { log "fetch 失败"; exit 1; }
git reset -q --hard origin/main >>"$LOG" 2>&1 || { log "reset 失败"; exit 1; }

# 3) 拉上游 + 生成 dist（复用仓库里的 sync.mjs，逻辑零重复）
OUT="$(node member-db/sync.mjs 2>&1)"; RC=$?
log "$OUT"
if [ "$RC" -ne 0 ]; then
  log "sync.mjs 退出码 $RC（上游不可达或数据劣化），保留远端现有 dist"
  exit "$RC"
fi

# 4) 无变化直接结束
if git diff --quiet -- member-db/dist/members.json; then
  log "关键内容无变化，结束"
  exit 0
fi

# 5) 提交并推送
git add -f member-db/dist/members.json
git -c user.name="member-db-relay" -c user.email="relay@yaya.local" \
  commit -q -m "chore(member-db): 同步上游成员库 $(date -u '+%F') (relay)" >>"$LOG" 2>&1
git push -q origin main >>"$LOG" 2>&1 || { log "push 失败"; exit 1; }
log "已推送到 main"

# 6) 清 jsDelivr 缓存（否则 @main 文件会被 CDN 缓存，最长 12h）
curl -sS --max-time 20 "https://purge.jsdelivr.net/gh/Xenia0922/yaya_msg_mobile@main/member-db/dist/members.json" >>"$LOG" 2>&1 \
  && log "jsDelivr 已 purge"
