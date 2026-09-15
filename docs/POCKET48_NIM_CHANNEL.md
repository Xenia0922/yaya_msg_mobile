# 口袋48 消息通道逆向与实现（云信 NIM）

> 依据：官方 **口袋48 7.1.39** APK 反编译（`E:\yymsg\_apk48\src48\sources`，jadx 1.5.1 + JDK17）。
> 结论一句话：**口袋48 的所有「发送」都走网易云信（NIM），HTTP 侧没有任何发送接口。**

## 1. 三条通道

| 场景 | 通道 | 关键参数 | RN 可实现性 |
|:--|:--|:--|:--|
| 直播弹幕（公屏，收/发） | 云信**聊天室** Chatroom | `chatroomId = getLiveOne.content.roomId`，`sourceId = liveId` | ✅ 官方 RN 版 SDK 直接可用 |
| 房间消息（收/发） | 云信**圈组** QChat | `serverId + channelId` | ⚠️ Web/RN SDK 无 QChat → 走原生 SDK |
| 私信/会话（收/发） | 云信**群组** Team | `sessionId = im/person/room/show → realRoomId` | ✅ 官方 RN 版 SDK 可用 |

- appKey：`632feff1f4c838541ab75195d1ceb3fa`（`com.pocket.snh48.lib.yunxin.im.NIMStrategy#getOptions` 明文）
- 聊天室接入点：`chatweblink01.netease.im:443`
- 登录凭证：HTTP `im/api/v1/im/userinfo` → `content.accid` + `content.pwd`

## 2. HTTP 侧无发送接口（已实测）

对 `https://pocketapi.48.cn/...` 做接口存在性探测：

- 存在接口 → `{"status":400,"success":false,"message":"缺少请求参数"}`（或「缺少token」）
- 不存在 → HTTP 404 `{"status":404,"error":"Not Found"}`

测过 `im/api/v1/team/message/send`、`im/api/v1/team/msg/send/text`、`im/api/v1/chatroom/msg/send`、
`im/api/v1/qchat/msg/send`、`live/api/v1/live/sendBarrage` 等 20+ 候选 —— **全部 404**。
对照组 `im/api/v1/team/message/list/all` 正常返回 400。

## 3. 直播弹幕

### 3.1 发送（官方 `IMChatRoom#sendTextMessage`）

房间文本消息 + `remoteExtension`：

```jsonc
{
  "fromApp": "201811",
  "roomId": "<chatroomId>",
  "sourceId": "<liveId>",
  "session": 0,
  "bubbleId": "0",
  "user": { "userId": 1, "nickName": "…", "avatar": "…", "level": 0, "roleId": 0 },
  "config": { "build": "181022", "phoneName": "Android", "phoneSystemVersion": "Android",
              "mobileOperators": "", "version": "7.1.39" },
  "text": "弹幕内容",
  "messageType": "BARRAGE_NORMAL",   // 成员 BARRAGE_MEMBER / 超管 BARRAGE_SUPERMAN / 付费 BARRAGE_PAY
  "module": "live",                  // 公开直播 = public
  "inTop": false
}
```

省略字段：`specialBadge` / `liveBubbleId`+`liveBubbleIosUrl`+`liveBubbleAndroidUrl` / `monthCardBadge`。

### 3.2 接收

聊天室推送的 `text`（msg_type 0）与 `custom`（msg_type 100）两类；`custom` 的
`remoteExtension.messageType` ∈
`BARRAGE_NORMAL / BARRAGE_MEMBER / BARRAGE_PAY / BARRAGE_SUPERMAN / BARRAGE_STARTWO /
PRESENT_NORMAL / PRESENT_TEXT / GENERAL_SEND_GIFT / EVENT_HAVEHEAD_ENTER / EVENT_NOHEAD_ENTER /
EVENT_VIP_ENTER / LIVE_ANNOUNCE / KTV_SONG_MSG`。

## 4. 房间消息（圈组 QChat）

官方 `com.pocket.snh48.lib.yunxin.im.group.MessageManger#sendTextMessage`：

```java
QChatSendMessageParam p = new QChatSendMessageParam(serverId, channelId, MsgTypeEnum.text);
p.setBody(text);
p.setExtension(UiKit.getChannelBaseParams(channelRole, bubbleId));
// extension = { channelRole, bubbleId, module: "QCHAT", user: {...} }
// 另有反垃圾参数：antiSpamUsingYidun = true, customAntiSpamContent = text
```

### 为什么必须走原生

`@yxim/nim-web-sdk`（含 `NIM_Web_SDK_rn.js`）里 qchat **只有** `service:"qchat" / cmd:"getQChatAddress"`，
没有任何消息收发命令；NetEase 也未发布 QChat 的 Web/RN SDK。因此本项目经原生桥
（官方 `com.netease.nimlib:basesdk` + `com.netease.nimlib:qchat`，Maven Central）调用。

## 5. 代码落点

```
src/third_party/nim/NIM_Web_SDK_rn.js      内置云信官方 RN SDK 9.21.14（module.exports = { NIM, Chatroom, … }）
src/third_party/nim/push-notification-ios-stub.js   SDK 顶层硬 require 的 iOS 推送库空实现
metro.config.js                             resolver 重定向上面这个 iOS 依赖
src/services/pocketNim/types.ts             appKey / MsgType / ModuleType / 类型
src/services/pocketNim/codec.ts             收：解析归一化；发：构造 remoteExtension；自实现 MD5（防伪标记）
src/services/pocketNim/runtime.ts           SDK 懒加载 + 凭证归一化
src/services/pocketNim/credentials.ts       凭证缓存（同一 App 生命周期只取一次）
src/services/pocketNim/chatroom.ts          LiveChatroom：连接 / 接收 / 发送 / 释放
src/services/pocketNim/qchat.ts             圈组房间消息收发（经原生桥）
src/hooks/useLiveBarrage.ts                 直播间弹幕 Hook（含去重、上限 300 条、重连）
src/components/LiveBarrageBoard.tsx         弹幕面板（列表 + 输入框，玻璃风格）
src/native/PocketIm.ts                      原生桥 JS 封装
src/api/pocket48.ts#getLiveChatroom         liveId → { roomId, sourceId }
android/.../PocketImModule.java             原生：init / login / sendChannelText / observeMessages
```

接入点：`src/screens/FollowedRoomsScreen.tsx`

- 房间内直播时挂 `LiveBarrageBoard`（实时弹幕，收 + 发）
- 底部「房间发言」输入条 → `sendRoomTextMessage`（圈组发送）
- 打开房间时订阅 `observeRoomMessages` → **圈组实时推送**（`qchatToRoomMessage` 对齐 HTTP 历史字段后走既有
  `mergeMessages` 合并）；原 15s HTTP 轮询保留为降级兜底（原生桥不可用 / 未登录 / 非 Android 时自动静默）

## 6. 已验证 / 未验证

已验证：
- `tsc --noEmit` 0 错误
- `:app:compileReleaseJavaWithJavac` 通过（原生模块 API 与 AAR 完全匹配）
- `assembleRelease` 出包成功；MuMu（x86_64）装机启动无 crash、无 RN 报错
- 自实现 MD5 对 RFC1321 三个标准向量结果正确

未验证（需登录态真机）：
- 聊天室登录/进房/发弹幕（需真实 accid+pwd）
- 圈组登录 + 房间发言（需真实账号且该圈组允许发言）

## 7. 体积影响（重要）

云信原生 SDK 自带 native 库，按 ABI 分包后：

| APK | Before | After |
|:--|:--|:--|
| arm64-v8a | 41.3 MB | **63.6 MB** |
| armeabi-v7a | 35.9 MB | **50.9 MB** |
| x86_64 | 43.8 MB | **64.0 MB** |
| universal | — | **157.2 MB** |

主要来自 `libhigh_available_android.so`(9.4M) / `libquicclient-jni.so`(5.3M) / `libne_audio.so`(1.6M)
/ `libfusionstorage.so`(0.9M) 与 NIM 类（dex +约 6M）。这些是 basesdk 的必需依赖（官方 APK 同样带），
直接剔除会在 init/登录时 NoClassDefFoundError 或 UnsatisfiedLinkError —— **不建议。**

若不需要「房间消息发送」，可整体回退原生部分（删两处 gradle 依赖 + PocketImPackage 注册 + 4 个文件），
弹幕（纯 JS）不受影响，体积回到原值。
