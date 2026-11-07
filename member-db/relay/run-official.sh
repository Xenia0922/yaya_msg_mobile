#!/usr/bin/env bash
# 官方成员快照中继（境内机，每天一次）
# ---------------------------------------------------------------------------
# GitHub Actions 出口被 pocketapi.48.cn 拦（403），本机阿里云 IP 直连也被拦，
# 但「出口守卫维护的代理 + 完整客户端指纹头」可用（2026-11-07 实测 200 / 910 条）。
# 因此独立于此仓库的 dist 中继，每天拉一次官方目录，有变化才提交。
#
# 部署：/root/member_db_relay/run-official.sh
# crontab：23 4 * * * flock -n /run/010push_member_db_relay.lock -c '/root/member_db_relay/run-official.sh' >> /root/member_db_relay/cron-official.log 2>&1
# 与 */2 的 run.sh 共用同一把 flock，避免两个脚本同时 git push。
set -uo pipefail

BASE="/root/member_db_relay"
REPO_DIR="$BASE/repo"
LOG="$BASE/official.log"
KEY="/root/.ssh/member_db_relay_ed25519"
REMOTE="git@github.com:Xenia0922/yaya_msg_mobile.git"
RAW="$BASE/official_raw.json"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG"; }

export GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
# 出口由 egress_guard 维护，读 010push 的 .env（只读这一项，不加载其它凭据）
EGRESS="$(grep -m1 '^POCKET48_EGRESS_PROXY=' /root/push_site/.env 2>/dev/null | cut -d= -f2- || true)"
export POCKET48_EGRESS_PROXY="$EGRESS"

mkdir -p "$BASE"

if [ ! -d "$REPO_DIR/.git" ]; then
  log "首次克隆（sparse: member-db）"
  git clone --depth 1 --filter=blob:none --sparse -b main "$REMOTE" "$REPO_DIR" >>"$LOG" 2>&1 \
    || { log "克隆失败"; exit 1; }
  git -C "$REPO_DIR" sparse-checkout set member-db >>"$LOG" 2>&1
fi

cd "$REPO_DIR" || exit 1
git fetch --depth 1 -q origin main >>"$LOG" 2>&1 || { log "fetch 失败"; exit 1; }
git reset -q --hard origin/main >>"$LOG" 2>&1 || { log "reset 失败"; exit 1; }

# 1) 带签名头 + 出口代理下载
OUT="$(python3 member-db/relay/fetch-official.py "$RAW" 2>&1)"; RC=$?
log "$OUT"
if [ "$RC" -ne 0 ]; then
  log "下载失败（退出码 $RC），保留远端现有快照"
  exit "$RC"
fi

# 2) 复用仓库脚本做校验 / 去重 / 降级保护
OUT="$(OFFICIAL_JSON_FILE="$RAW" node member-db/fetch-official.mjs 2>&1)"; RC=$?
log "$OUT"
if [ "$RC" -ne 0 ]; then
  log "写出失败（退出码 $RC），保留远端现有快照"
  exit "$RC"
fi

# 3) 无变化直接结束，不产生空提交
if git diff --quiet -- member-db/official/members.json; then
  log "官方快照无变化，结束"
  exit 0
fi

git add -f member-db/official/members.json
git -c user.name="member-db-relay" -c user.email="relay@yaya.local" \
  commit -q -m "chore(member-db): 更新官方成员快照 $(date -u '+%F %H:%M') (relay)" >>"$LOG" 2>&1
git push -q origin main >>"$LOG" 2>&1 || { log "push 失败"; exit 1; }
log "官方快照已推送到 main"
