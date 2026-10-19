#!/usr/bin/env bash
# 【测试用】上传 v2.7.7 假版本 Release，触发应用内更新链路。
# 资产内容 = 普通版 v2.7.6（已含全部新功能），只是**发布名**用 v2.7.7 好让 2.7.6 检测到更新。
# 测完删除：gh release delete v2.7.7 --yes --cleanup-tag
set -euo pipefail
cd "$(dirname "$0")/.."

TAG=v2.7.7
REPO=Xenia0922/yaya_msg_mobile
APK_DIR="${APK_DIR:-/e/yymsg/APK}"

echo "== 0/4 准备资产（本地 v2.7.6 文件 → v2.7.7 资产名） =="
STAGE=$(mktemp -d)
for abi in v8a v7a x64; do
  cp "$APK_DIR/yaya-msg-mobile-v2.7.6-$abi.apk" "$STAGE/yaya-msg-mobile-v2.7.7-$abi.apk"
done
cp "$APK_DIR/yaya-msg-mobile-v2.7.6.apk" "$STAGE/yaya-msg-mobile-v2.7.7.apk"
ls -l "$STAGE"

echo "== 1/4 推送标签 =="
git tag -f "$TAG"
git push origin "$TAG"

echo "== 2/4 取凭据 =="
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | sed -n 's/^password=//p')
if [ -z "$TOKEN" ]; then echo "未取到 git 凭据，请先 gh auth login"; exit 1; fi

echo "== 3/4 创建 Release =="
BODY='{"tag_name":"v2.7.7","name":"v2.7.7（更新链路测试）","body":"临时测试包：验证应用内更新链路，测试完删除。内容与 v2.7.6 相同。","draft":false,"prerelease":false}'
RESP=$(curl -s -X POST "https://api.github.com/repos/$REPO/releases" \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  -d "$BODY")
RELEASE_ID=$(echo "$RESP" | sed -n 's/.*"id": \([0-9]*\).*/\1/p' | head -1)
if [ -z "$RELEASE_ID" ]; then echo "创建失败：$RESP" | head -c 400; exit 1; fi
echo "release id=$RELEASE_ID"

echo "== 4/4 上传资产 =="
for f in "yaya-msg-mobile-v2.7.7-v8a.apk" "yaya-msg-mobile-v2.7.7-v7a.apk" "yaya-msg-mobile-v2.7.7-x64.apk" "yaya-msg-mobile-v2.7.7.apk"; do
  echo "  上传 $f"
  curl -s -X POST "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$f" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary "@$STAGE/$f" | grep -o '"state": "[a-z]*"' | head -1
done

echo "完成：https://github.com/$REPO/releases/tag/$TAG"
echo "测完删除：gh release delete $TAG --yes --cleanup-tag"
