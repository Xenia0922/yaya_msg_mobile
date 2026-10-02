#!/usr/bin/env bash
# 成员库镜像中继（境内机版本）
# ---------------------------------------------------------------------------
# 为什么需要它：
#   GitHub Actions（Azure 出口 IP）请求 https://data.gnz.hk/members.json 恒返回 403
#   （Cloudflare 按 IP/机房段拦，加 Referer/浏览器 UA 无效，见 2026-09-27 日志）。
#   本机（境内）可正常 200，因此改由本机拉上游 → 生成 dist → 提交回 GitHub main
#   → 清 jsDelivr 缓存。App 端无需改动即可自动拿到最新成员库。
#
# 触发方式（2026-10-02 起）：上游一变就同步。
#   crontab 每 2 分钟跑一次，但只在「上游 ETag 变化」时才真拉全量；
#   ETag 未变直接静默退出（不下载、不打日志）。故上游更新 → 镜像更新 ≤ 2 分钟，
#   常态开销只是一个 HEAD 请求。
#
# 部署位置：/root/member_db_relay/run.sh（阿里云 8.163.75.157）
# crontab：*/2 * * * * /root/member_db_relay/run.sh >> /root/member_db_relay/cron.log 2>&1
# 依赖：node >= 18（apt install nodejs）、git、curl
# 推送凭据：/root/.ssh/member_db_relay_ed25519（仓库 Deploy key，read/write）
set -uo pipefail

BASE="/root/member_db_relay"
REPO_DIR="$BASE/repo"
LOG="$BASE/relay.log"
KEY="/root/.ssh/member_db_relay_ed25519"
REMOTE="git@github.com:Xenia0922/yaya_msg_mobile.git"
ETAG_FILE="$BASE/upstream.etag"
UPSTREAM_URL="https://data.gnz.hk/members.json"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
REFERER="https://gnz.hk/database"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG"; }

export GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

mkdir -p "$BASE"

# 1) 轻量变更探测：上游 ETag 未变 → 静默退出（省掉 1.2MB 下载 + dist 生成 + git 操作）
CUR_ETAG="$(curl -sI --max-time 15 -A "$UA" -e "$REFERER" "$UPSTREAM_URL" 2>/dev/null \
  | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')"
if [ -n "$CUR_ETAG" ] && [ -f "$ETAG_FILE" ] && [ "$(cat "$ETAG_FILE")" = "$CUR_ETAG" ]; then
  exit 0
fi
# 拿不到 ETag（上游改头/网络抖动）时照常走全量流程，由 sync.mjs 的 contentHash 兜底

# 2) 首次克隆（稀疏：只要 member-db 目录，避免拉整个仓库）
if [ ! -d "$REPO_DIR/.git" ]; then
  log "首次克隆（sparse: member-db）"
  git clone --depth 1 --filter=blob:none --sparse -b main "$REMOTE" "$REPO_DIR" >>"$LOG" 2>&1 \
    || { log "克隆失败"; exit 1; }
  git -C "$REPO_DIR" sparse-checkout set member-db >>"$LOG" 2>&1
fi

cd "$REPO_DIR" || exit 1

# 3) 对齐远端 main
git fetch --depth 1 -q origin main >>"$LOG" 2>&1 || { log "fetch 失败"; exit 1; }
git reset -q --hard origin/main >>"$LOG" 2>&1 || { log "reset 失败"; exit 1; }

# 4) 拉上游 + 生成 dist（复用仓库里的 sync.mjs，逻辑零重复）
if [ -n "$CUR_ETAG" ]; then log "上游 ETag 变化（$CUR_ETAG），开始同步"; fi
OUT="$(node member-db/sync.mjs 2>&1)"; RC=$?
log "$OUT"
if [ "$RC" -ne 0 ]; then
  log "sync.mjs 退出码 $RC（上游不可达或数据劣化），保留远端现有 dist"
  exit "$RC"
fi

# 5) 无变化（ETag 变了但关键字段没变，如上游 utime/ctime 抖动）→ 记下 ETag，免得反复拉
if git diff --quiet -- member-db/dist/members.json; then
  if [ -n "$CUR_ETAG" ]; then echo "$CUR_ETAG" > "$ETAG_FILE"; fi
  log "关键内容无变化，结束"
  exit 0
fi

# 6) 提交并推送
git add -f member-db/dist/members.json
git -c user.name="member-db-relay" -c user.email="relay@yaya.local" \
  commit -q -m "chore(member-db): 同步上游成员库 $(date -u '+%F %H:%M') (relay)" >>"$LOG" 2>&1
git push -q origin main >>"$LOG" 2>&1 || { log "push 失败"; exit 1; }
log "已推送到 main"

# 7) 清 jsDelivr 缓存（否则 @main 文件会被 CDN 缓存，最长 12h）
curl -sS --max-time 20 "https://purge.jsdelivr.net/gh/Xenia0922/yaya_msg_mobile@main/member-db/dist/members.json" >>"$LOG" 2>&1 \
  && { [ -n "$CUR_ETAG" ] && echo "$CUR_ETAG" > "$ETAG_FILE"; log "jsDelivr 已 purge"; }
