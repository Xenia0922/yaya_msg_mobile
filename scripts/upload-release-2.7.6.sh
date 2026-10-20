#!/usr/bin/env bash
# 发布 v2.7.6 正式版（普通版）。
# 前置：当前分支 = public-2.7.7（公版代码，channel=public），APK 已用标准名构建完毕。
# 依赖：Clash 代理（127.0.0.1:7890）+ git credential 里有 GitHub token。
# 用法：GIT_SSL_NO_VERIFY= bash scripts/upload-release-2.7.6.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TAG=v2.7.6
REPO=Xenia0922/yaya_msg_mobile
APK_DIR="${APK_DIR:-/e/yymsg/APK}"
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890

echo "== 0/4 检查资产 =="
for f in yaya-msg-mobile-$TAG-v8a.apk yaya-msg-mobile-$TAG-v7a.apk yaya-msg-mobile-$TAG-x64.apk yaya-msg-mobile-$TAG.apk; do
  [ -f "$APK_DIR/$f" ] || { echo "缺少 $APK_DIR/$f"; exit 1; }
  echo "  $f  $(stat -c%s "$APK_DIR/$f" 2>/dev/null || stat -f%z "$APK_DIR/$f") bytes"
done

echo "== 1/4 推送标签（当前分支应为 public-2.7.7） =="
git branch --show-current
git tag -f "$TAG"
git push -f origin "$TAG"

echo "== 2/4 取凭据 =="
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | sed -n 's/^password=//p')
[ -n "$TOKEN" ] || { echo "未取到 git 凭据"; exit 1; }

echo "== 3/4 创建 Release（已存在则复用） =="
BODY=$(cat <<'JSON'
{"tag_name":"v2.7.6","name":"v2.7.6","body":"## v2.7.6 更新\n\n**房间 / 礼物**\n- 礼物面板改版：图片网格 + 数量输入 + 点空白收起\n- 无直播的房间也能直接送礼；小房间送礼与入口修复\n- 礼物/贡献榜空列表修复\n\n**消息**\n- 头像框显示、粉丝账号等级（Lv.N）\n- `[表情]` 消息正式渲染；语音显示时长\n- 新增「私信未读红点」开关（设置 → 消息）\n- 房间消息时间被截断修复\n\n**音乐**\n- 修复音乐页卡死、切歌封面消失、时长不显示\n- 歌曲卡片与专辑网格统一\n\n**更新与推送**\n- 应用内直接更新（下载进度 + 自动安装），境内自建源加速\n- 设置新增「010 推送」入口；下载页迁移 gnz48.tech/app\n\n**功耗**\n- 房间消息兜底轮询 15s → 60s（长连接为主通道）\n- 直播弹幕 / B站开播轮询：后台暂停、回前台补拉\n\n**其他**\n- 鸡腿榜去掉年榜，成员贡献榜优化\n- 大小房间切换背景不刷新修复\n\n**下载**：真机用 `v8a`，模拟器用 `x64`，不确定用 `universal`。","draft":false,"prerelease":false}
JSON
)
RESP=$(curl -s -X POST "https://api.github.com/repos/$REPO/releases" \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  -d "$BODY")
RELEASE_ID=$(echo "$RESP" | sed -n 's/.*"id": \([0-9]*\).*/\1/p' | head -1)
if [ -z "$RELEASE_ID" ]; then
  echo "创建失败（可能已存在同名 Release）："
  echo "$RESP" | head -c 400
  echo
  RELEASE_ID=$(curl -s "https://api.github.com/repos/$REPO/releases/tags/$TAG" \
    -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"id": \([0-9]*\).*/\1/p' | head -1)
  echo "复用 release id=$RELEASE_ID"
  [ -n "$RELEASE_ID" ] || exit 1
fi

echo "== 4/4 上传资产（同名已存在会 422，先删后传） =="
for f in yaya-msg-mobile-$TAG-v8a.apk yaya-msg-mobile-$TAG-v7a.apk yaya-msg-mobile-$TAG-x64.apk yaya-msg-mobile-$TAG.apk; do
  OLD_ID=$(curl -s "https://api.github.com/repos/$REPO/releases/$RELEASE_ID/assets" \
    -H "Authorization: Bearer $TOKEN" | grep -o "\"id\":[0-9]*,\"node_id\":\"[^\"]*\",\"name\":\"$f\"" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
  if [ -n "$OLD_ID" ]; then
    curl -s -X DELETE "https://api.github.com/repos/$REPO/releases/assets/$OLD_ID" -H "Authorization: Bearer $TOKEN" >/dev/null
    echo "  已删除旧资产 $f"
  fi
  echo "  上传 $f"
  curl -s -X POST "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$f" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary "@$APK_DIR/$f" | grep -o '"state": "[a-z]*"' | head -1
done

echo "完成：https://github.com/$REPO/releases/tag/$TAG"
