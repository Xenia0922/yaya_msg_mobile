# 成员库中继（relay）

GitHub Actions 抓不到上游时的替代同步通道。**App 端与用户无需任何操作。**

## 为什么需要

App 的成员库数据源是 jsDelivr 上的本仓库产物
`Xenia0922/yaya_msg_mobile@main/member-db/dist/members.json`。
它的更新依赖「拉取上游 → 生成 dist → 提交 main」，而这一步原本跑在 GitHub Actions 上。

2026-09-27 定位：**Actions 恒 403**。

| 事实 | 证据 |
|---|---|
| Actions 每次运行都 403 | 2026-09-25 ~ 09-27 抽查 5 次运行日志全部 `上游拉取失败：HTTP 403` |
| 不是 UA / 缺 Referer 的问题 | 补上浏览器 UA + `Referer: https://gnz.hk/database` 后仍 403 |
| 是 IP / 机房段拦截 | 同时段 check-host 全球 11 个普通节点（德/新/港/土/越…）访问上游全部 **200** |
| 曾长期假成功 | 旧 `sync.mjs` 失败分支 `process.exit(0)` → workflow 显示 success，实际上 7 天没写出过数据 |

`dist` 的历史提交作者也全是人工，无一条 `github-actions[bot]` —— 佐证 Actions 从未成功写出。

## 方案

换出口。**境内机（阿里云 8.163.75.157）能正常 200 拉上游**，由它承担同步：

```
data.gnz.hk ──(境内机 curl/node)──→ sync.mjs 生成 dist
                                        │
                                        ├─→ git push → GitHub main（Deploy key）
                                        └─→ purge.jsdelivr.net 清 CDN 缓存
                                                     │
                                                     └─→ App 下次启动自动拿到最新
```

复用仓库里的 `member-db/sync.mjs`，**抓取/覆盖/劣化护栏逻辑零重复**。

## 部署

```bash
# 1) 依赖
apt-get install -y nodejs git curl        # node >= 18（需要全局 fetch）

# 2) 脚本
mkdir -p /root/member_db_relay
# 上传本文件同目录的 run.sh 到 /root/member_db_relay/run.sh，并 chmod +x

# 3) 推送凭据：仓库 Deploy key（read/write）
ssh-keygen -t ed25519 -f /root/.ssh/member_db_relay_ed25519 -N '' -C 'member-db-relay'
cat /root/.ssh/member_db_relay_ed25519.pub
#   → 把公钥加到 https://github.com/Xenia0922/yaya_msg_mobile/settings/keys
#     勾选 Allow write access

# 4) 定时
crontab -e
# 追加：
0 * * * * /root/member_db_relay/run.sh >> /root/member_db_relay/cron.log 2>&1

# 5) 首次跑通
bash /root/member_db_relay/run.sh && tail -20 /root/member_db_relay/relay.log
```

## 验证与排障

```bash
# 最近几次运行结果
tail -40 /root/member_db_relay/relay.log

# 期望（无更新时）
#   [member-db] 上游同步成功：962 位（https://data.gnz.hk/members.json）
#   [member-db] 关键内容未变化（hash ...），跳过写出
#   [..] 关键内容无变化，结束

# 期望（有新数据时）
#   [member-db] 已写出 dist/members.json：963 位 ...
#   [..] 已推送到 main
#   [..] jsDelivr 已 purge

# 推送权限自检（不实际写入）
cd /root/member_db_relay/repo && \
  GIT_SSH_COMMAND="ssh -i /root/.ssh/member_db_relay_ed25519 -o BatchMode=yes" \
  git push --dry-run origin main

# 线上产物是否真的更新（绕开本机对 jsDelivr 的 SSL 问题）
curl -s "https://cdn.jsdelivr.net/gh/Xenia0922/yaya_msg_mobile@main/member-db/dist/members.json" | head -c 200
```

| 症状 | 处置 |
|---|---|
| 日志停在 `fetch 失败` | 检查 Deploy key 是否被删 / 网络 |
| `sync.mjs 退出码 2` | 本机也拉不到上游了，查 `curl -I https://data.gnz.hk/members.json` |
| `sync.mjs 退出码 0` 但无更新 | 正常：上游关键字段（映射/名称/在团）没变，`contentHash` 相同 |
| 提交成功但 App 仍旧数据 | 跑了 purge 却仍缓存 → 等 CDN TTL，或再手动 purge 一次；App 侧还有 6h 本地 TTL |

## 注意

- 该机同时承载 010Push 推送服务，本任务只增加每小时一次约 1.2MB 的下载，负载可忽略。
- 若该机停用，需把 `run.sh` 迁到另一台**非 Cloudflare / 非 Azure** 出口的机器（换机时记得换 Deploy key）。
- Actions 侧已停用 schedule（见 `.github/workflows/member-db-sync.yml`），避免每小时一条无意义的失败通知。
