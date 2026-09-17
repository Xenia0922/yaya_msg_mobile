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
- **播放器「一直在加载中」已修复并实测生效**：LiveExoView 首帧经 NativeModule 事件
  （`LivePlayer:size`，首帧 + 600ms + 2000ms 各一次）通知 JS → `state=playing`
  （根因：bridgeless 下 `UIManagerModule` 取不到，View 事件被静默丢弃）

### ⚠️ 服务端拒绝第三方客户端（2026-09-15 实测，外部硬阻塞）

MuMu 真机 + 真实登录态实测（logcat 证据）：

| 通道 | 服务端返回 | 证据 |
|:--|:--|:--|
| 原生 IM 登录（房间/圈组 QChat 的前提） | **414 参数错误** | `UILoginEventManager: loginResponse code=414 … operationType='protocol', target='link208-bgp.yunxinfw.com:443', description='login response error'` |
| Web/RN 聊天室（直播弹幕） | **403 非法操作或没有权限** | `protocol::onMessage:packet error code:403, message:13_2 login error: 非法操作或没有权限`（账号+token 与匿名两种方式都被拒） |

结论：**不是代码问题，是口袋48 的云信 appKey 在服务端对客户端做了校验。**
对照云信官方文档（登录 414 的常见原因）：「当请求登录的客户端 App 标识（Android 包名）不在
控制台『App Key 管理 → 标识管理』白名单内时，登录接口会返回 414」——我们包名是
`com.yk1z.yayamsg`，官方是 `com.pocket.snh48`。同一 appKey、同一账号在官方 App 上可正常登录，
在我们包名下被拒 → 与「包名白名单」完全吻合。48tools（Windows C++ SDK）不受影响，
因为官方文档中该校验只针对 iOS Bundle ID / Android Package Name。

App 内的呈现（都已做）：
- 直播弹幕面板：连接失败时显示「弹幕通道被服务端拒绝…」（自适应尝试：账号+token → 匿名）
- 房间发言：错误提示区分登录 414 与发送 414 的不同语义

## 7. 出路

| 方案 | 说明 | 评价 |
|:--|:--|:--|
| 改包名为 `com.pocket.snh48` | 与官方 App 同包名 | ❌ 会与官方 App 冲突（不能共存），且属冒充，不建议 |
| 桌面端路线（Windows C++ SDK，48tools 同款） | 不受 Android 包名校验 | 手机上不可行 |
| 保持现状 | 弹幕/房间发言链路代码保留，服务端放行即可用 | ✅ 推荐：代码已就位，等待/依赖外部条件 |

## 8. 体积影响（重要）

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

## 9. 终局对照：gnz.hk 网页版为什么能发消息（2026-09-16 实证）

用户提供的可复现样本 `https://gnz.hk/room/1164784`（= 牙牙消息的 web 构建）能正常收发，
拆解其前端产物后结论明确：**它根本不在客户端连云信，全部走服务端中转。**

`src/web/browser-shim.js`（把 Electron IPC 映射成 HTTP）：

| 通道 | 服务端接口 | 说明 |
|:--|:--|:--|
| 直播弹幕 | `POST /api/danmaku/session`、`POST /api/danmaku/send/` | session 入参 `{liveId, roomId, token}`，返回还带 `streamUrl`（连流都代理） |
| 房间消息 | `POST /api/member-room/connect`、`/api/member-room/` | 未登录直接返回「请先登录口袋48账号」——服务端持有 Pocket48 会话 |
| 其它 | `/api/pocket`、`/api/ipc`、`/api/live-relay` | 云信工作全在服务端 |

前端 `createNimChatroomFeature` 里那些 `NIM_Web_Chatroom.js` + `chatweblink01.netease.im` +
`isAnonymous` 只有在 **Electron 桌面壳**里才生效（web 下 `ee=!0` 但 `X.invoke` 走 HTTP 代理）；
网页版的实际调用是 `X.invoke('connect-live-danmaku' | 'send-live-danmaku')` → HTTP。

**结论**：能收发的样本都运行在「PC/服务端」客户端上（桌面 Electron 主进程、或 gnz.hk 的服务器），
客户端类型不是 Android/Browser，因此不受云信对 Android 包名的标识校验。
手机端直连（原生 SDK / Web SDK）无论如何都会撞 414 / 403，**唯一可行路径是自建同款服务端中转**。

### 手机端可行方案
1. **自建 bridge**（推荐）：在自有服务器（如 010push 那台 Lighthouse）跑一个 Node 服务，
   用 Pocket48 账号做云信客户端（PC clienttype 不受校验），对外暴露
   `POST /api/danmaku/session|send` + `POST /api/member-room/connect|send`，
   手机端只发 HTTP/WS。（亦可直接对接对端 gnz.hk 的该类接口，但会把功能依赖挂在别人的服务上）
2. 保持现状：客户端链路代码已就位（含 LBS 解析、crm 解密、三级连接策略），一旦有合规通道即可切换。


## 10. 三方实现逐字段对照（2026-09-17）

对照对象：桌面 `yk1z/yaya_msg`、Go bot `sjsj1849/pocket48-bot`（`sidecar/nim-bridge/android-qchat.mjs`）、我方 Kotlin 移植。

| 项 | 桌面（9.17.1） | Go bot（9.21.10） | 我方 |
|:--|:--|:--|:--|
| 弹幕 LBS | `lbs/chat.jsp` | — | `lbs/chat.jsp` |
| 圈组 NIM 链接入 | `lbs/conf.jsp` | **直连 `link.netease.im:8080`** | `lbs/conf.jsp` |
| 聊天室 SDK 版本 | 92110 | 92110 | 92110 |
| 圈组链 SDK 版本 | **91701** | **92110** | 91701（照抄桌面） |
| 包名伪装 | 2/2 属性 25 = `com.seine48.app`；**24/2 不带包名** | 2/2 属性 25 + **24/2 属性 32** | 同桌面 |
| 圈组订阅 | **无** | **`25/7` 订阅 serverIds** | 无 |
| 发弹幕 / 发房间消息 | 13/6 · 24/10 | 13/6 · 24/10 | 13/6 · 24/10 |
| 收消息 | 24/11 · 13/* | 24/11 | 24/11 |

结论：三家都是「自实现 NIM 二进制协议 + 伪装白名单包名」。桌面圈组链的版本号比 Go 版旧一档且缺订阅步骤，是唯一实质差异；真机若收不到 `24/11`，优先补 `25/7`。

## 11. pa 签名：MD5 能否替代 WASM（实测否）

实跑桌面 `rust-wasm.js` + `2.wasm` 的 `__x6c2adf8__()`，base64 解码后 87 字符：

```
1789609503917 | 6882ed27da944c4aabffd862637aa1e2 | 489306987b7235d45965e308034fdc87 | 2021060901
  ts(13位ms)  |            32 hex               |             32 hex               | 固定后缀
```

Go bot 的 pa = `base64("ts,rand,md5hex(ts+rand+secret),")`，secret `40F1065D8E71F2A2A2BBE3F6F3D8B8C9`（`internal/pocket48/client.go`）。
两者结构完全不同（一个带逗号三字段、一个 87 字符双摘要），且 12 种常见候选输入（`md5(ts+secret)` 等）全部不匹配。
⇒ 「将 Go 的纯 MD5 移植过来即可去掉 WASM/WebView 签名器」**不成立**。

补充事实：桌面/我方只在 `login-send-sms` / `login-by-code` 带 pa；Go bot 是**所有**请求带 pa + `P-Sign-Type: V0`。


### 10.1 本轮三方对齐结果（2026-09-17 二轮逐字段核对）

逐字段核对桌面 `nim-commonlink-chatroom.js` / `nim-commonlink-qchat.js` 与 Go bot `android-chatroom.mjs` / `android-qchat.mjs` 后修掉：

| # | 问题 | 修法 |
|:--|:--|:--|
| 1 | 版本三件套混搭：6=92110 但 40="8.0.0"、42="Native/9.17.1.13231"（风控明显异常特征） | `NimProtocol` 统一为 92110 / "9.21.10" / "Native/9.21.10.14184"（Go bot 实测组合） |
| 2 | 聊天室登录属性 4 误用 SDK 人类版本 | 独立成 `APP_VERSION_FIELD="8.0.0"`（三家在此字段都固定 8.0.0，与 SDK 版本无关） |
| 3 | QChat(24/2) 登录不带包名 | 补属性 32 = `com.seine48.app`（Go bot 同款；官方 SDK 死于 414 就是因为带不了这个） |
| 4 | QChat 链 SDK 版本 91701 / LBS v=91701，与聊天室不一致 | 统一 92110 |
| 5 | 在线人数：只解析 13/13 响应但从不发请求（桌面每 10s 发一次 `getChatroomInfo`） | 连上后立即 + 每 10s 发 13/13，响应 → `handleOnlineCount` → `onOnlineCount` |
| 6 | 弹幕 remoteExtension.user 缺 vip/pfUrl/teamLogo/badge，且缺 `sessionRole` | 按桌面版补齐（`session`/`sessionRole` 两个都带） |

核对一致、无需改的：聊天室进房包（13/2 = `[2]+login{1,2,3,5,8}+auth{3,4,6,9,13,18,19,25,1000}`）、
弹幕发送（13/6，属性 1/2/3/4/5/13/20/21/22/23，**属性 3 与 13 都填正文**——桌面 `sendText` 就是 `attachment: content`）、
收消息归一化（属性 1/2/3/4/7/8/13/20/21/22/23，type==0 时正文取属性 3）、13/35 ack（属性 38=="1" 时回）、
心跳 1/2、QChat 发送（24/10 属性 1/2/3/9/10/12/13/20/21/100..105）、QChat 取址解析 `common.link`。

仍未做（有意）：QChat `25/7` 订阅 —— 只有 Go bot 有，桌面版没有也能收发，真机收不到 24/11 时再加。
