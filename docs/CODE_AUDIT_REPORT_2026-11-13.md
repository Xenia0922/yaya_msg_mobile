# yaya_msg-mobile 代码合理性与规范性审查报告

- **报告日期**：2026-11-13
- **审查对象**：`E:\yymsg\_gh_analysis`（yaya_msg-mobile，v2.7.8 / versionCode 3000011）
- **当前工作区**：分支 `public`，HEAD `fb660f4`（`chore: 初始化公开仓库 v2.7.8`），工作区干净
- **原审查基线**：`5fbb098`（`public-2.7.8`，2026-11-13 10:05）。`fb660f4` 与基线相比，`src/`、`App.tsx`、`package.json`、`tsconfig.json`、`app.json` 无源代码差异；公开提交另外删除了 `docs/`、`member-db/relay/`、`scripts/upload-release-2.7.6.sh`、`scripts/upload-release-2.7.7-test.sh`、`scripts/gh_api.py`、`new-keys*.json` 等 49 个文件（移入被 `.gitignore` 忽略的 `_internal/`），并移除了 `network_security_config.xml` 中的 `admin.seine48.com` 证书 pin。
- **审查范围**：208 个 TypeScript/TSX 源文件（49,174 行）、`android/app/src/main/java` 下 38 个 Java/Kotlin 文件、48 个 `scripts/` 脚本，以及 Gradle、Manifest、网络配置、GitHub Actions、app.json、tsconfig、README 等工程配置。
- **审查方式**：以只读静态审查为主；实测 `npm run typecheck`、`npm run test:core`、`node scripts/check-i18n-coverage.js`、`node scripts/i18n-full-coverage.js`、`node scripts/unused-styles-check.js`、`node scripts/check-hooks-order.js`、`node scripts/dup-check.js`、`npm audit`；对 Android release 构建执行了 `gradlew :app:assembleRelease --dry-run --offline` 配置级验证。未执行完整 `assembleRelease`、真机运行、UI/E2E 测试和 APK 签名篡改实测。

> 说明：报告中的严重级别是“代码风险级别”，不等于线上已经发生的事故。P0 表示一旦触发会造成数据丢失、不可升级或核心功能不可用；P1 表示高概率的功能错误、竞态、泄漏或安全风险；P2 表示可维护性/规范性问题；P3 表示轻微风格问题。审查期间工作区曾被外部重建为 `public` 分支，本报告以当前 `public` HEAD `fb660f4` 为准，并单独标注仅存在于原基线 `5fbb098` 的文件。

---

## 一、执行摘要

### 1. 总体结论

项目整体架构清晰，核心链路有不少有意识的历史加固：统一网络层、大整数解析、WASM 哈希校验、APK 包名/签名校验、凭据加密迁移、下载写盘串行化、23 个 Node 回归测试都说明维护投入较高。

但当前代码**不具备“可直接发布”的质量门禁**：

- 已确认 **2 个 P0**：下载状态机在正常运行期会把活跃任务改成失败并可能删除文件；release 构建缺少签名参数时会静默回退到 debug 签名，产出无法覆盖安装的 APK。
- 存在一批 **P1 级竞态与生命周期缺陷**，集中在播放器/音乐互斥、NIM 重连与消息桥、下载/账号/凭据持久化、若干大型页面的异步请求覆盖，以及 Android 前台服务与 NIM 原生客户端。
- 规范性方面：无 ESLint/Prettier、无 lint/format CI 门禁；`any` 使用量很大（`: any` 630 处、`as any` 233 处）；23 个文件超过 500 行；组件、页面、API 巨石化明显；i18n、可访问性、硬编码颜色和死代码均有可量化缺口。

### 2. 最优先修复项（按顺序）

1. **`src/services/downloads.ts:116-130` 下载状态机**：`loadDownloadItems` 每次读取都把 `downloading/queued` 改成 `failed`，而 `updateItem`、`enqueueDownload`、`enforceCacheQuota` 和 400ms 进度刷新都会调用它；随后 `clearFinishedDownloads` 可能把仍在下载的任务当“已完成”删除本地文件。这是确定性数据丢失路径。
2. **release 签名强制化**：`android/app/build.gradle:83-86` 的 `requireReleaseSigning` 默认 `false`，`:166-172` 缺签名参数时回退 `signingConfigs.debug`；`package.json:28` 未传 `-Pyaya.requireReleaseSigning=true`，CI 也没有强制要求 release keystore。
3. **凭据存储 fail-open 与空基线覆盖**：`secretStore.readMap` 读取失败会以空 map 继续写；`SecureVault` 加密失败会静默明文落盘；`accountVault` 读取失败会以空列表覆盖全部已保存账号。
4. **播放器/音乐互斥与全屏恢复**：`PlayerCore` Web 回退标记在渲染阶段被重置，可能永久停在 loading；`musicPlayer.playTrack` 解析期间不暂停旧歌；全屏关闭不恢复竖屏；视频/小窗与音乐 `loading` 状态互斥不完整。
5. **Android 前台服务与 NIM 客户端生命周期**：`RadioForegroundService` 首次前台通知、主线程封面解码和最终 `startForeground` 有 5 秒崩溃/ANR 风险；`NimQChatClient` 重连不销毁旧 session；`NimChatroomClient.stop/start` 可产生双 worker；`PocketNimChatroomModule.send` 存在 Promise 永久悬挂竞态。
6. **网络响应体超时**：`network.ts`、`auth/index.ts`、`officialSiteMusic.ts`、`r2Music.ts` 在 `fetch` 返回响应头后就清理了 timer，`res.text()/arrayBuffer()` 不受超时保护。
7. **大型页面异步请求取消**：BilibiliLive、RoomRadio、MeleeRank、FlipScreen、FollowedRooms 均有旧请求/旧分页覆盖新状态的路径。
8. **Fabric 下 `removeClippedSubviews` 风险**：实际构建 `IS_NEW_ARCHITECTURE_ENABLED=true`，但 8 处列表显式开启 `removeClippedSubviews`，`PerfFlatList.tsx:17-20` 自己注释了 Fabric 下可能触发 `RetryableMountingLayerException`。

### 3. 已复核但不作为 P0 的项

- `android/app/build.gradle:129-135,193-203` 的 `defaultConfig.ndk.abiFilters` 与 `splits.abi` 配置看起来冲突，注释也自认可能触发 AGP `Conflicting configuration`；但实测 `gradlew :app:assembleRelease --dry-run --offline` 配置阶段成功（28 tasks up-to-date），未复现。保留为 **P2 配置清理项**，仍需真实 `assembleRelease` 验证。
- `src/services/pocketNim/codec.ts:37-61` 将 `msg.content` 作为 `ext` 候选、从 `ext.user` 取昵称/头像/roleId，普通文本若 content 为 JSON 可伪造“超管/成员”显示样式；但这是**客户端展示层欺骗**，不改变服务端权限，按 **P1 显示完整性/信任边界** 处理，不按 P0 安全提权处理。

---

## 二、P0 详细问题

### P0-1 下载状态机在正常运行时把活跃任务改成失败，并可能删除文件

**位置**

- `src/services/downloads.ts:116-130` — `loadDownloadItems`
- `src/services/downloads.ts:147-154` — `updateItem`
- `src/services/downloads.ts:184-187` — `enqueueDownload`
- `src/services/downloads.ts:297-308` — `clearFinishedDownloads`
- `src/services/downloads.ts:317` — `enforceCacheQuota`
- 下载页 400ms 进度刷新也调用 `loadDownloadItems`

**证据**

```ts
return Array.isArray(parsed)
  ? parsed.map((item) => item.status === 'downloading' || item.status === 'queued'
    ? { ...item, status: 'failed' as const, error: '应用重启后下载中断，请重试' }
    : item)
  : [];
```

`loadDownloadItems` 的注释假设“只在 App 启动时读取一次”，但实际每次 `updateItem`、`enqueueDownload`、`enforceCacheQuota` 以及下载页轮询都会重新读取整表。结果：

1. 多任务同时下载时，任何一个任务完成并触发配额清理，其他仍在下载的任务会被写成 `failed`。
2. 下载页下一次轮询读到 `failed`，UI 显示“应用重启后下载中断”，用户点击“清理完成”后 `clearFinishedDownloads` 过滤 `status === 'done' || status === 'failed'`，对这些“假失败但仍在写盘”的任务执行 `FileSystem.deleteAsync(item.localUri)`。
3. 真实下载器仍持有文件路径继续写入，产生孤儿文件、假完成或 `updateItem` 找不到记录；用户文件可能被删除，属于确定性数据丢失路径。

**建议**

- 将“启动时恢复中断任务”拆成 `recoverInterruptedDownloads()`，只在 App 初始化调用一次。
- 运行期 `loadDownloadItems` 原样返回，不修改状态。
- 维护内存中的 `activeDownloadIds`；`clearFinishedDownloads`/配额清理排除有活跃 writer 的任务。
- 为每个任务保存取消句柄，删除前先 abort 并等待 `downloadWriteChain` 收尾。

### P0-2 release 构建可静默使用 debug 签名

**位置**

- `android/app/build.gradle:83-86` — `requireReleaseSigning` 默认 `'false'`
- `android/app/build.gradle:140-160` — debug keystore 密码固定为 `'android'`
- `android/app/build.gradle:166-172` — 缺 `RELEASE_*` 时回退 `signingConfigs.debug`，只 `println` 警告
- `package.json:28` — `build:android` 未传 `-Pyaya.requireReleaseSigning=true`
- `.github/workflows/android-apk.yml:96-118` — 仅在 secret 存在时还原 release keystore，没有强制 release 签名

**影响**

release APK 可能被打上调试证书。Android 不允许用不同签名覆盖安装同包名应用，用户只能卸载旧版本再安装，从而丢失本地数据；分发后再修正签名也无法平滑升级。这个风险在 CI 缺 secret、开发者本机构建、或误用 `assembleRelease` 时都会出现。

**建议**

- release 构建缺少完整 `RELEASE_*` 时直接 `throw new GradleException(...)`，不要回退 debug。
- `build:android` 显式传 `-Pyaya.requireReleaseSigning=true`。
- CI 在构建前校验 keystore/alias/password 四项 secret，缺失即失败。
- 增加构建产物签名校验脚本，校验 `apksigner verify --print-certs` 的证书 SHA-256 与生产证书一致。

---

## 三、P1 详细问题

### 3.1 构建、发布与 CI

- **P1-B1 锁文件失败时静默 `npm install`**：`.github/workflows/android-apk.yml:66` 使用 `npm ci ... || npm install ...`。`npm ci` 因 lockfile 不一致失败时会悄悄安装新版本依赖，破坏可复现构建并引入供应链漂移。建议删除 `|| npm install`，锁文件错误必须让流水线失败。
- **P1-B2 质量门禁缺少 lint/format**：`.github/workflows/quality.yml:23-33` 只有 `npm ci`、`npm run typecheck`、`npm run test:core`、`git diff --check`。项目没有 ESLint/Prettier 配置和脚本，`git diff --check` 在干净 checkout 上是空操作。建议新增 ESLint + Prettier，CI 执行 `eslint .`、`prettier --check`，并把 `git diff --check` 改为检查实际变更。
- **P1-B3 出包分支绕过质量检查**：`.github/workflows/quality.yml:3-8` 只监听 `main`、`plus`、`public-*`；`.github/workflows/android-apk.yml:8-10` 的 `ci-build` push 不触发 quality，出 APK 的分支可以绕过 typecheck/test。建议统一 workflow_call 或在 android-apk 构建前复用 quality job。
- **P1-B4 发布上传脚本（仅原基线 `5fbb098`，当前在 `_internal/scripts`）**：`upload-release-2.7.7-test.sh:29` 设置 `draft:false, prerelease:false`，但资产实际是本地 v2.7.6 APK 改名 v2.7.7，执行会把旧包发布成全量可见正式版；`upload-release-2.7.6.sh:21-24` 分支检查只打印、不校验分支，随后 `git tag -f` 和 `git push -f`，误执行会公开 plus 私有分支并覆盖 tag。当前 public HEAD 已不跟踪这些脚本，但如果仍从 `_internal/scripts` 手工执行，风险不变。建议彻底删除或改为显式 `--confirm-production` + 分支/版本/签名三重校验。

### 3.2 网络、认证与本地存储

- **P1-C1 响应体读取不受超时保护**：`src/utils/network.ts:23-26` 的 `fetchWithTimeout` 在 `fetch` resolve 后即进入 `.finally` 清理 timer；`:142-143` 又在 `await res.text()` 前 `clearTimeout(timer)`。`src/auth/index.ts:136-141` 同样在 `await resp.arrayBuffer()` 前清理 timer；`src/api/officialSiteMusic.ts:102-104`、`src/api/r2Music.ts:55-57` 的 `res.text()` 也受影响。服务器返回响应头后不发送 body 会让请求永久挂起。建议把 timer 保留到 body 消费完成，或用统一 `AbortSignal`/`Promise.race` 包裹整个响应。
- **P1-C2 `findSelfHostedUrl` 无 timeout**：`src/utils/appUpdate.ts:46-61` 裸 `fetch`，没有 `AbortController`/body 超时；`UpdateInstaller.tsx:121-126` 在 `await findSelfHostedUrl` 之后才切到 `downloading`。接口挂起时更新界面一直停在旧状态。建议改用统一超时请求并把“检查中”状态放到请求前。
- **P1-C3 `secretStore.readMap` 读取失败覆盖全部凭据**：`src/services/secretStore.ts:24-34` 在 `AsyncStorage.getItem` 或 `JSON.parse` 失败时执行 `cache = {}`；`:42-55` 的 `setSecret` 随后以空 map 为基线只写当前 key，一次瞬时读取失败会抹掉全部旧 token/cookie。
- **P1-C4 凭据加密失败静默明文落盘**：`src/native/SecureVault.ts:23-25` 在原生模块不存在或 `encrypt` 失败时返回 `null`；`src/services/secretStore.ts:51-53` 写入 `map[key] = enc == null ? plain : ...`；`src/services/accountVault.ts:38-42` 对整个账号仓同样执行 `enc == null ? json : ...`。`isSecretStorageEncrypted` 只检查原生模块对象存在，无法发现单次加密失败。建议 fail-closed：拒绝保存并提示，至少不要静默写明文。
- **P1-C5 账号仓读取失败按空列表覆盖**：`src/services/accountVault.ts:58-67` 的 `listSavedAccounts` 把读取/解密/JSON 解析错误全部 `catch { return []; }`；`:70-90` 的 `saveCurrentAccount` 以空列表为基线写入当前账号，瞬时解密失败会清空全部已保存账号。
- **P1-C6 账号仓并发写覆盖**：`src/services/accountVault.ts:70-96` 的 `saveCurrentAccount`/`removeSavedAccount` 都是“读整表→改→写”，没有写链或互斥；两个并发保存/删除可能基于同一旧列表，后写覆盖先写。建议像 `downloads.ts` 的 `withDownloadWrite` 一样串行化。
- **P1-C7 WebView 签名器全局状态无 generation 归属**：`src/auth/webviewSigner.tsx:24-39` 的 `signerReady/signerError/signerRequest/pending` 都是模块级状态；`:430-450` 的 `onMessage` 收到 `ready` 直接置 true，收到 `error` 拒绝全部 pending，没有实例/generation 校验。WebView 以 `key={generation}` 重挂载后，旧实例迟到消息会让新实例误判 ready，或取消新请求的签名等待。建议每条消息携带 generation，按实例维护独立 pending/ready。
- **P1-C8 `memberData` 上游 fallback 永久失效**：`src/services/memberData.ts:137-174` 的 `sources=[...MEMBERS_URL_SELF_LIST, MEMBERS_URL]` 中，`:150-154` 只有 SELF_LIST 的 URL 解析 `updatedAt`，上游 `data.gnz.hk` 恒为 `0`；一旦 `previousUpdatedAt` 非 0，`if (previousUpdatedAt && (!updatedAt || updatedAt < previousUpdatedAt)) throw` 会永久拒绝上游数据。自建镜像挂掉后无法回退到上游，只能靠本地缓存。建议把 `updatedAt=0` 视为“无版本信息”而不是过期。
- **P1-C9 QChat 旧退订误断新连接**：`src/services/pocketNim/qchat.ts:96-112` 的 `resetQChatSession` 把 `observeRefCount` 清零；`:417-429` 旧 unsub 用 `Math.max(0, observeRefCount - 1)` 递减，新连接刚订阅 `count=1` 时旧 unsub 会减到 0 并 `qchatDisconnect()`，误断新连接。
- **P1-C10 Chatroom `open()` 的 disposed 二次检查缺失**：`src/services/pocketNim/chatroom.ts:253-341` 只在入口检查 `disposed`；`:269` `await webImLoginProbe` 返回后没有再次检查，`:282` 仍 `Chatroom.getInstance`，dispose 后仍会创建实例/定时器/重连，泄漏资源。
- **P1-C11 聊天消息身份可被普通文本伪造（显示层）**：`src/services/pocketNim/codec.ts:37-61` 的 `readExt` 把 `msg.content` 作为 ext 候选，`:142-220` 的 `parseChatroomMessage` 从 `ext.user` 取 `nick/avatar/roleId`。普通文本若 content 是 JSON，可伪造“超管/成员”显示样式。仅客户端展示欺骗，不影响服务端权限；建议只信任 `remoteExtension` 字段并校验类型。

### 3.3 播放器、音频与原生媒体

- **P1-P1 PlayerCore Web 回退标记在渲染阶段被重置**：`src/player/core/PlayerCore.tsx:214-217` 的复位逻辑在渲染期执行。`webFallbackDone` 初值 `false`、`sourceChangedRef` 初值 `''`，首次渲染不执行复位；音频原生失败在 `:151-158` 置 `webFallbackDone=true` 并 `setUseWebKernel(true)`，下一轮渲染因 `sourceChangedRef !== source.url` 又把标记重置为 `false`。WebKernel 再失败时会再次进入 fallback，但 `useWebKernel` 已为 true 不会重建，最终永久停在 `loading`，无错误出口。建议用 `useEffect` 按 source.url 复位，并增加 `webFallbackAttempted` 守卫；Web 内核已启用时失败必须进入 error。
- **P1-P2 切歌解析期间旧歌继续播放**：`src/services/musicPlayer.ts:348-371` 的 `playTrack` 只 `store.play(track)`（`:201-218` 设置 `loading` 且保留旧 `url`），然后 `await resolver`；全函数没有 `exoControl('pause'/'stop')`。解析失败后 UI 显示新歌/错误，但旧歌仍在响。`:552-555` 注释明确“stop 只清 store 不会让原生 Exo 停声”。建议解析前显式 pause，失败时 stop 并恢复一致状态。
- **P1-P3 全屏卸载不恢复竖屏**：`src/player/chrome/FullscreenManager.tsx:23-32` 在 `fullscreen=true` 时 `lockAsync(LANDSCAPE)`，false 时 `PORTRAIT_UP`，但 cleanup 仅 `setLiveImmersiveMode(false)`；`PlayerChrome.tsx:530` 非 inline 全屏点关闭直接 `onClose()`，PlayerScreen 卸载后屏幕仍锁定横屏。建议 cleanup 恢复 `PORTRAIT_UP`，关闭前先退出全屏。
- **P1-P4 视频/小窗与音乐 `loading` 互斥缺失**：`src/player/store/playerStore.ts:142-149` 和 `src/store/miniPlayerStore.ts:57-65` 打开视频/小窗时只暂停 `playing`/`paused`，漏掉 `loading`。音乐解析完成后仍会 `setPlaybackState('playing')`，视频与音乐双路出声。建议统一 `pauseForExternalPlayback()`，条件包含 `loading`。
- **P1-P5 YayaExoService 队列元数据错配**：`android/app/src/main/java/com/yk1z/yayamsg/YayaExoService.java:352-375` 的 `playQueue` 循环中 `title/artist/album/artPath` 每轮覆盖，最终元数据等于队列最后一项；`:355-359` 的 `lastTrackUrl/lastTrackId` 只在 `i==0` 赋值，`:620-645` 的 `emitProgress` 却当作当前曲发送；`:380-385` 的 `sameTrack` 只与 `firstUrl` 比较。`index>0` 时通知、MediaSession、进度事件元数据全部错配，重复下发队列会整曲重载。建议按 index 设置当前元数据，并在 `onMediaItemTransition` 更新 lastTrack。
- **P1-P6 同一首歌的暂停分支被注释**：`YayaExoService.java:393-396` 只有 `if (playing && !exo.getPlayWhenReady()) exo.play();`，`// else if (!playing && exo.getPlayWhenReady()) exo.pause();` 被注释，JS 下发 `playing=false` 不会暂停。建议恢复 pause 分支并处理 `posMs>0` 的 seek。
- **P1-P7 JS 冻结时后台切歌本地 hint 永不执行**：`YayaExoService.java:535-537` 的 `localSkip` 先判断 `RadioExoModule.emitJs(..., "cmd", ...)`，而 `RadioExoModule.java:35-57` 的 `emitJs` 只要 `hasActiveCatalystInstance()` 为 true 就 emit 并返回 true；ColorOS 冻结 JS 时事件只是排队，本地 hint 永远不会执行。建议本地 hint 优先，或 JS 回执/超时后再回退，不能以 emit 成功当 JS 已处理。
- **P1-P8 RadioForegroundService 前台启动 5 秒崩溃/ANR 风险**：`RadioForegroundService.java:123-142` 的 `onCreate` 未创建通知渠道；`:184-226` 首次 `startForeground` 用引用 `CHANNEL_ID` 的 `buildMinimalNotification()`，异常被 `catch (Throwable ignored)` 吞；`:198-217` 在主线程同步 `decodeFile/decodeDataUri` 封面；`:219-226` 最终 `startForeground` 在 try 外。封面大或解码慢时 5 秒内未进入前台会触发 `RemoteServiceException`/ANR，`buildNotification()` 异常会直接崩溃。建议 `onCreate` 建渠道、封面解码移到后台、最终 `startForeground` 包 try/catch 并先完成占位通知。
- **P1-P9 NimQChatClient 重连不销毁旧 session**：`NimQChatClient.kt:107-140` 每次 `onConnected` 启动 `nim-qchat-link` 线程并直接 `qchatSession = qchat`，未 `destroy()` 旧 `qchatSession`，重连会泄漏旧 socket/线程，可能重复消息、重复回调。建议赋值前销毁旧 session，stop/destroy 统一清理。
- **P1-P10 NimChatroomClient 双 worker**：`NimChatroomClient.kt:84-100` 的 `stop()` 只置 `stopped=true` 并关 socket，不 join 旧 worker；`start()` 又把 `stopped` 置 false，旧 worker sleep 后继续重连，出现两个 worker/两条 socket。建议保存 worker 引用并 `join`，或使用 generation token 让旧 worker 永久退出。
- **P1-P11 PocketNimChatroomModule.send Promise 竞态**：`PocketNimChatroomModule.kt:113-131` 先阻塞执行 `active.sendText(...)`，之后才 `sendPromises[idClient] = promise`；服务端回执可能先到并 `remove` 不到 promise，Promise 永久悬挂；`:148-155` 的 `disconnectInternal` 遍历 map 与主线程回调并发修改还可能 `ConcurrentModificationException`。建议发送前注册 promise、使用线程安全 map 或统一切主线程读写。

### 3.4 页面、组件与导航

- **P1-S1 BilibiliLiveScreen 直播间切换无请求序号**：`src/screens/BilibiliLiveScreen.tsx:333-398` 的 `startWatch` 没有请求序号；快速切直播间时旧 `resolveLive` 响应覆盖新房间流/标题。建议用 `watchSeqRef`/AbortController。
- **P1-S2 RoomRadioScreen 旧响应覆盖新选择**：`src/screens/RoomRadioScreen.tsx:164-213` 的 `startRadio` 在 `await fetchRadioUrl` 后无条件 `applyStreamUrl`，没有校验 `selectedMember` 是否仍当前。建议请求时保存选择 token，返回后校验。
- **P1-S3 MeleeRankScreen 请求竞态与分页污染**：`src/screens/MeleeRankScreen.tsx:203-228` 的 `loadPerson` 无请求序号；`:160-201` 的 `loadMoreRank` 无序号，切周榜后旧分页 append 到新榜且 catch 静默 `hasMore=false`。建议请求序号 + 周榜 key 校验。
- **P1-S4 FlipScreen 失败仍推进 pageRef**：`src/screens/FlipScreen.tsx:815-820` 的 `onEndReached` 先把 `pageRef=nextPage`，失败不回退；重试只 `loadFlips(1,true)` 不重置 `pageRef`，会漏整页。
- **P1-S5 FollowedRooms 轮询闭包过期**：`src/screens/FollowedRoomsScreen.tsx:1689` 的 30s 轮询用初始 `liveNow` 闭包判断空结果；effect 依赖只有 `[selectedRoom]`（`:1741`），保护失效会清空直播状态。建议用 ref 读取最新 liveNow。
- **P1-S6 FollowedRooms 置顶写序竞态**：`src/screens/FollowedRoomsScreen.tsx:1525-1548` 的 `togglePin/movePin` 基于闭包 `pinned` 计算 next 后直接 `AsyncStorage.setItem`，无串行化；快速点击会覆盖或写序错乱。
- **P1-S7 FollowedRooms 消息分页判断错误**：`src/screens/FollowedRoomsScreen.tsx:1870-1872` 与 `src/screens/FollowedRooms/messageUtils.ts:87-91` 的 `getNextTime(res,list)` 不使用 `list`，只读 `nextTime|next|lastTime`，缺失返回 0；非空列表也常不能翻页，`setHasMoreMessages(nextTime>0 && list.length>0)` 随之失效。
- **P1-S8 PrivateMessagesScreen 显式开启 `removeClippedSubviews`**：`src/screens/PrivateMessagesScreen.tsx:1185` 等价 `true`，违反 `src/components/PerfFlatList.tsx:17-20` 的注释：Fabric 下与挂载指令队列竞态可致 `RetryableMountingLayerException`（"Unable to find viewState for tag"）。当前 `BuildConfig.IS_NEW_ARCHITECTURE_ENABLED=true`，属于真机崩溃风险。应删除或设为 false。
- **P1-S9 `withPageMotion(OnMicScreen, ...)` 在渲染体内创建**：`src/navigation/index.tsx:408` 在 `AppNavigator` 渲染体内调用，父组件因 theme/screenBackdrop/pocketToken 重渲染会产生新组件类型，OnMicScreen 整页卸载重挂丢状态；其他屏均为模块级 `*StackScreen` 包装（`:90-111`）。应改为模块级包装。
- **P1-S10 useLiveBarrage 去重窗口建立太晚**：`src/hooks/useLiveBarrage.ts:179-204` 的 `send` 先 `await instance.send(content)` 再 `await loadSelfProfile()`，之后才写 `lastLocalRef` 和乐观弹幕；服务端回投若在两个 await 前到达，去重窗口尚未建立（`:142-151`），自己的弹幕重复上屏。应发送前登记本地消息 key，或使用 clientId 去重。
- **P1-S11 UpdateInstaller 双击并发下载**：`src/components/UpdateInstaller.tsx:116-162` 的 `startDownload` 先 `await findSelfHostedUrl`（:121）再 `setPhase('downloading')`（:126），await 期间 phase 仍 `ready`；主按钮 disabled 只排除 `checking/installing`（:261），快速双击会并发两次下载，第二次 `cleanup()` 注销第一个下载的进度监听。`visible=false` 的 effect（:67-92）只 cleanup 不取消后台下载，重开弹窗（:75-80）重置 `checking/percent/apkPathRef`，后台仍在下却显示空闲，可再次启动；安装失败/权限拒绝也显示“下载失败”（:236-237）。建议请求前先置 `checking`，用 `downloadIdRef` 防重入，卸载时调用 `cancelApkDownload`。

---

## 四、P2/P3 问题清单

以下为系统性、可维护性和边缘问题，按模块归档，建议纳入后续迭代和 lint 规则，不必全部阻塞当前发布。

### 4.1 架构与类型规范

| 编号 | 位置 | 问题与建议 |
|---|---|---|
| P2-A1 | 全仓库 | 无 ESLint/Prettier 配置、无 lint/format 脚本；建议引入 `eslint` + `@typescript-eslint` + `prettier`，CI 强制。 |
| P2-A2 | 全 src | `: any` 630 处、`as any` 233 处；热点：`FollowedRoomsScreen.tsx` 66+62、`MediaScreen.tsx` 48+28、`src/api/pocket48.ts` 41+15、`PrivateMessagesScreen.tsx` 47+9。建议逐步替换为领域类型，禁止新增 any。 |
| P2-A3 | 23 个文件 >500 行 | `FollowedRoomsScreen.tsx` 4634、`MediaScreen.tsx` 2723、`src/api/pocket48.ts` 2071、`PrivateMessagesScreen.tsx` 1389、`LoginScreen.tsx` 1345、`MusicLibraryScreen.tsx` 999、`PlayerChrome.tsx` 972、`musicPlayer.ts` 891。建议按页面区域/领域拆 hooks、子组件和 service。 |
| P2-A4 | `src/theme/colors.ts:104-115` | `Colors` 与 `DarkColors` 全仓无引用；`colors.ts:86-87` import 在 export 之后；`usePageBackground()` 恒返回 `'transparent'`（:99-101）。建议删除死 API 或改为真实主题 token。 |
| P2-A5 | `src/constants/index.ts:46` | `USER_AGENT` 全仓无引用，且版本与 20+ 处硬编码 UA `PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)` 不一致。建议统一为常量/函数。 |
| P2-A6 | `src/types/index.ts:303-363`、`src/constants/identityFeatures.ts:4-6` | `AppSettings` 含大量自定义发言身份字段；公开版 `ALLOW_CUSTOM_SENDER_PROFILE/TEAM_LOGO/IDENTITY_ROLES = IS_PLUS_BUILD`，`credentials.ts:9` 导入 `ALLOW_CUSTOM_IDENTITY_ROLES` 但未使用。建议清理未用字段/导入，明确 builds 差异。 |
| P2-A7 | `tsconfig.json` | include 仅 `src`，exclude 含 `scripts`、`android`；48 个脚本和原生代码不参与 tsc。建议为 scripts 增加独立 `tsconfig` 和类型检查。 |
| P2-A8 | `app.json:9`、`android/gradle.properties:38` | `newArchEnabled:false` 与 `newArchEnabled=true` 冲突；实际 `BuildConfig.IS_NEW_ARCHITECTURE_ENABLED=true`。建议唯一配置源，避免 prebuild 覆盖。 |
| P2-A9 | `app.json:15-28` | `android.permissions` 只列 INTERNET/ACCESS_NETWORK_STATE，实际 Manifest 还有前台服务、通知、安装 APK、悬浮窗等 9 项权限。Expo prebuild 可能丢失权限。 |

### 4.2 网络/API/数据

| 编号 | 位置 | 问题与建议 |
|---|---|---|
| P2-D1 | `src/utils/network.ts:142-143` + `src/api/officialSiteMusic.ts:102-104`、`src/api/r2Music.ts:55-57` | body 读取超时缺失（详见 P1-C1）；建议统一 `requestJson` 流式消费/超时包装。 |
| P2-D2 | `src/api/officialMedia.ts:15-23`、`:34-62` | 长整数正则无尾部分隔符；`desktopPost` 用 XMLHttpRequest 自建网络层，无 AbortSignal/统一错误语义；第 1 行 `useSettingsStore` 未使用。建议统一网络层。 |
| P2-D3 | `src/services/downloads.ts:184-187` | 同 URL 旧记录被 `filter` 删除但不删除旧 `localUri`，`done` 条目产生不计入 4GB 配额的孤儿文件；进行中旧任务失去记录。建议替换前取消旧任务并删除旧文件。 |
| P2-D4 | `src/services/downloads.ts:285-295` | `deleteDownloadItem` 删除本地文件前不 abort 下载器，下载器随后写回已删路径，产生孤儿文件和假完成。建议维护任务句柄表，先 abort 再删。 |
| P2-D5 | `src/services/settings.ts:96-104,145-160` | `loadSettings` 读取/解析失败继续用 `DEFAULT_SETTINGS` 并缓存；任意 `saveSettings` 会以默认值为基线覆盖全量设置；`settingsCache = merged` 在持久化前更新，落盘失败内存/磁盘不一致。 |
| P2-D6 | `src/utils/runtimeLog.ts:46-53` | Cookie 脱敏正则值字符类遇到 `;` 停止，`Cookie: SESSDATA=xxx; DedeUserID=123; buvid3=...` 只替换第一段。建议整行 Cookie 整体脱敏。 |
| P2-D7 | `src/services/autoCheckin.ts:15-25,90-95` | 无用户信息时以 `token:${String(token).slice(-16)}` 作为用户标识写入普通设置 `yaya_auto_checkin_last_user`，token 片段明文持久化。建议用不可逆哈希/随机本地 id。 |
| P2-D8 | `src/api/pocket48.ts:857-911` | 小房间 fallback 用 `[params.serverId || '']` 而非 `serverIds`，空 sid 最终抛 `missing serverId`。建议传完整 serverIds 或明确错误。 |
| P2-D9 | `src/services/pocketNim/roomMetaCache.ts:55-66`、`roomBgCache.ts:72-101`、`liveDecorations.ts:72-94` | 内存 Map 无上限；并发旧 map 覆盖；force 刷新旧请求回写。建议 LRU + generation/AbortController。 |
| P2-D10 | `src/api/external.ts` | `fetchJson<any>` 泛化响应类型；建议用泛型 `fetchJson<T>` 并调用方校验。 |
| P2-D11 | `src/screens/MediaScreen.tsx:323`、`src/player/resolve/sharePage.ts:14` | 直接 `fetch('https://pocketapi.48.cn/live/api/v1/live/getLiveOne')`，绕过 `src/api` 层，重复 UA/错误处理。建议统一 API client。 |

### 4.3 播放器/音频/Android 原生

| 编号 | 位置 | 问题与建议 |
|---|---|---|
| P2-P1 | `src/player/PlayerScreen.tsx:136-143` | 卸载 cleanup 条件依赖 `source.url`，`open()` 会把 source.url 换成候选/解析 URL，条件不成立导致全局 playerStore 残留。建议每次 open 生成 token，按 token 无条件 close。 |
| P2-P2 | `src/player/core/NativeKernel.tsx:49-60` | `bufferConfig` 放在 `source` 内，RNV v6 应为顶层 prop，配置不生效。 |
| P2-P3 | `src/player/resolve/streamResolver.ts:86-99` | `collectUrlsDeep` 把封面/图片 URL 也并入候选，只有 `streamScore` 排序，未用 `isPlayableMediaUrl` 过滤；无有效流时可能把图片当播放源。 |
| P2-P4 | `src/player/resolve/streamResolver.ts:21-38,107-123`、`MiniPlayer.tsx:265-276`、`radio.ts:8-10` | 多处只认 `rtmp://` 不认 `rtmps://`，同一 URL 在不同模块被误判。建议集中协议判定函数。 |
| P2-P5 | `src/player/resolve/sharePage.ts:10-22` | fetch 无 timeout、不检查 `resp.ok`，catch 全吞，接口挂起时播放器永久等待。 |
| P2-P6 | `src/services/bilibiliDanmaku.ts:131-143,192-202` | 切房无 generation，旧 socket 的 `onclose` 可打断新连接；建议 generation token + `if (this.ws !== ws) return`。 |
| P2-P7 | `src/store/onMicStore.ts:382`、`:202-218` | `clear()` 不清 `currentRound.aborted`；`await hydrateRoomMap()` 后直接 set scanning，无 isCurrent 校验。 |
| P2-P8 | `src/services/musicPlayer.ts:112-138`、`:695-714` | 原生切歌不递增 `_playSeq`，旧歌词覆盖新曲；stop 后迟到 progress 可复活 playing。 |
| P2-P9 | `YayaExoService.java:157-191` | 每个封面 URL `new Thread` 无并发上限/取消，`BitmapFactory.decodeByteArray` 全尺寸解码，快速切歌可 OOM。建议单线程 executor + inSampleSize + 取消。 |
| P2-P10 | `YayaExoService.java:690-718` + `:404` | `buildNotification()` 捕获全部异常返回 null，`:404` 直接传给 `ServiceCompat.startForeground`；通知构建失败服务无法进入前台，5 秒超时崩溃。 |
| P2-P11 | `YayaExoService.java:130-134` | `musicActuallyPlaying` 只在 `onPlayWhenReadyChanged` 更新，`STATE_ENDED` 不置 false，播完后 `MainActivity.stopMusicIfIdle` 判断失效。 |
| P2-P12 | `YayaExoService.java:67-68` 与 `RadioForegroundService.java:41-42` | 两个前台服务都用 `NOTIFICATION_ID=2024`，渠道分别 `yaya_radio_v3`/`yaya_radio_v2`，并存时通知互相覆盖。 |
| P2-P13 | `RadioForegroundService.java:346-396`、`:229-238` | `tryLoadCoverOnce` 下载完成直接 `coverBitmap = bmp`，未校验 URL 是否仍是当前封面；`wakeLock.acquire()` 无超时，异常时持续耗电。 |
| P2-P14 | `MainActivity.kt:147-150,125-137` | `onDestroy` 未移除 `reassertHandler` 的 delayedReassert callbacks；`onResume` 无条件 `reassertExoSession`，视频 PiP 返回时可能把媒体卡重绑到已暂停音乐。 |
| P2-P15 | `PipModule.java:60-73,172-178` | static `savedReactContext/savedAppContext` 在 `onCatalystInstanceDestroy` 不清空，React 上下文/Activity 泄漏。 |
| P2-P16 | `RadioExoModule.java:59-66`、`RadioServiceModule.java:110-128` | O+ 一律直接 `startForegroundService`，未捕获 `ForegroundServiceStartNotAllowedException`；`syncPosition` 用普通 `startService`。 |
| P2-P17 | `NimProtocol.kt:69-82,115-129,155-184` | `readVarint` 可溢出为负；`decodeProperties` 未校验长度非负；`decodePacket` 允许负 `frameLength`，`inflate` 初始容量可溢出，畸形包可打断 NIM 读线程。 |
| P2-P18 | `PocketImModule.java:322-337` + `src/native/PocketIm.ts:17-22` | `serverId/channelId` 以 double 接收再转 long，64 位 ID 超过 2^53 会丢精度，消息可能发错频道。建议桥接改字符串。 |
| P2-P19 | `AndroidManifest.xml:23`、`res/xml/network_security_config.xml:4` | `usesCleartextTraffic=true` 且 base-config 全局 `cleartextTrafficPermitted=true`，媒体/接口流量可被中间人窃听/篡改。建议默认禁止，只对确有需要的媒体域名开 `domain-config`。 |
| P2-P20 | `android/app/build.gradle:113-116,75,173-174,99,269,276-283` | Android Lint 完全关闭；`minifyEnabled=false`、`shrinkResources=false`；`jsc-android:2026004.+` 动态版本；`okhttp 4.9.2` 偏旧；同时引入旧 ExoPlayer 2.19.1 与 media3 1.8.0 双播放栈。建议升级/收敛依赖并恢复 lint。 |
| P2-P21 | `android/app/build.gradle:129-135,193-203` | `ndk.abiFilters` 与 `splits.abi` 列表不一致（x86 只在前者）；`--dry-run` 未复现 AGP 冲突，但配置重复，建议统一由 `splits.abi` 管理。 |
| P2-P22 | `MainActivity.kt:49` | `super.onCreate(null)` 丢弃 `savedInstanceState`，旋转/进程重建后 PiP/compact 状态丢失。 |
| P2-P23 | `PublicDownloadsModule.kt:82`、`BiliLoginModule.java:fetchTicket` | `saveToDownloads` 接受任意 `file://`；`fetchTicket` 对任意 URL GET 并返回 Set-Cookie（SSRF/凭据泄露面）。建议限制来源域/路径白名单。 |
| P2-P24 | `ApkUpdaterModule.java:255-275` | `verifyApkSigner` 只要求下载包证书摘要集合与已安装应用有交集，非严格相等；多签名 APK 含历史证书即可过（实际利用仍需旧证书私钥）。建议比较集合完全一致。 |

### 4.4 页面、组件与可访问性

| 编号 | 位置 | 问题与建议 |
|---|---|---|
| P2-U1 | `src/hooks/useSafeAreaInsets.ts:30-36` | iOS `top` 用 `StatusBar.currentHeight || 44`（仅 Android 有值）、bottom 固定 34/48、left/right 恒 0，横屏/手势导航会遮挡或留白；`ScreenHeader.tsx:30`、`AppTabBar.tsx:198`、`UserProfileSheet.tsx:360`、`ZoomImageModal.tsx:239/254` 各自固定 padding。建议统一 `react-native-safe-area-context`。 |
| P2-U2 | `src/components/AppDialog.tsx:70-79` | 先 `hideDialog` 再 `try { void Promise.resolve(btn.onPress()) } catch {}`，async rejection 成为未处理拒绝。建议 `await` 并 catch。 |
| P2-U3 | `src/components/AppToast.tsx:23-46` | message 清空时退场动画无宿主视图，只能瞬间消失。建议保留退出节点直到动画完成。 |
| P2-U4 | `src/components/GlassSegmented.tsx:71-73` | `options=[]` 时 `cellW = Infinity`，Animated 出现 NaN。建议空数组 guard。 |
| P2-U5 | `src/components/AppTabBar.tsx:119-124` | 指示器 effect 依赖 `[activeIndex, indX]` 但使用 `cellWRef`，旋转/宽度变化后位置错误；`CELL_MIN=64` 极窄屏 5 tab 超宽；`:99 maxShift` 未用。 |
| P2-U6 | `src/components/IdentityDecorations.tsx:6,101-149`、`RoomStickerPanel.tsx:6,62`、`RoomFlipQuestion.tsx:6` | 静态 `t` 不订阅语言变化，多个中文硬编码（“正在刷新装扮…/头像框/勋章/官方气泡/直播进场特效/直播弹幕气泡/加载失败/装扮已刷新”）。建议使用 `useI18n()` 并补 key。 |
| P2-U7 | `src/i18n/en.ts:98`、`ja.ts:98`、`ko.ts:98` | “关闭”被译为 `Off`/`オフ`/`끄기`，Modal 关闭按钮语义错误；应使用 `Close`/`閉じる`/`닫기`。 |
| P2-U8 | `src/components/Button.tsx`、`HeaderAction.tsx`、`SearchBar.tsx` | 缺 `accessibilityRole/Label/State`；全 src `accessibility*` 51 处 vs `<Touchable*/Pressable>` 212 处（约 24%）。建议补关键控件语义。 |
| P2-U9 | `src/components/Pill.tsx:34,60` | 选中白字 vs `rgba(255,111,145,0.20)` 玻璃底对比度低，建议检查 WCAG 对比度。 |
| P2-U10 | `src/components/ZoomImageModal.tsx:95-155` | 使用 `(scale as any).__getValue()` 私有 API，多处 `useNativeDriver:false` 与注释矛盾。建议改用 `Animated.Value` 公开 API。 |
| P2-U11 | `src/screens/SettingsScreen.tsx:240-249`、`UsagePreferencesScreen.tsx:209-218` | 乐观 `setSettings` 后 `saveSettings` 失败只 toast 不回滚，重启丢设置。建议失败回滚或重新加载。 |
| P2-U12 | `src/screens/ProfileScreen.tsx:103-119` | `autoLoadedRef` 在 members 未加载时提前写 key，导致永久空资料。建议成功后写 key。 |
| P2-U13 | `src/screens/home/LiveModule.tsx:43-51` | 封面失败 `setTimeout` 未清理。 |
| P2-U14 | `src/screens/OnMicScreen.tsx:95-96` | `renderItem` 每行 `members.find` O(n²)，entries 每次渲染重建。建议 Map 索引 + memo。 |
| P2-U15 | `src/screens/BilibiliLiveScreen.tsx:89-92,140,400-414` | 未使用状态/函数，建议删除。 |
| P2-U16 | `src/screens/FollowedRoomsScreen.tsx` 各列表 | 多处内联 `renderItem`、无行级 memo、宽泛 `keyExtractor`，30/60s 轮询放大重渲染。建议行组件 memo + 稳定 key。 |

### 4.5 脚本、文档与仓库卫生

| 编号 | 位置 | 问题与建议 |
|---|---|---|
| P2-R1 | `scripts/build-apk.js:10`、`scripts/upload-release-2.7.6.sh:11-13`、`scripts/gh_api.py:11`（基线） | 硬编码 `E:/yymsg/APK`、`/e/yymsg/APK`、Clash 代理 `127.0.0.1:7890`，不可移植。 |
| P2-R2 | `package.json:28`、`src/constants/buildChannel.ts:4` | `build:android` 不调用 `scripts/write-build-channel.js`，`BUILD_TAG` 为旧 `public-1113-0009`；`build-apk.js:13-16` 只认 `branch==='plus'`，detached/ci-build 被当 public。 |
| P2-R3 | `scripts/verify-version.js:19-22,64` | `fail` 只设 `process.exitCode=1` 不返回，后续仍打印 `✅ [verify-version] 版本一致`，错误时日志自相矛盾。 |
| P2-R4 | `scripts/check-i18n-coverage.js:39-45` | 只匹配 `t(`，不匹配 `translate(`（全仓 34 处 translate）；报告 844 key/4 缺失，`i18n-full-coverage.js` 报 862 key/6 缺失，漏 `[链接消息]`、`未知错误` 等。 |
| P2-R5 | `scripts/unused-styles-check.js`、`check-hooks-order.js`、`dup-check.js` | 未接入 npm scripts/CI；`check-hooks-order.js:36` 只打印不设 exit code；`unused-styles-check --fail` 未接线。 |
| P2-R6 | `scripts/melee-parse.test.mjs:10` | `mkdtempSync` 后不清理，`node_modules` 下已残留大量 `.meleetest-*`。 |
| P2-R7 | `.github/workflows/android-apk.yml:66`、`quality.yml:23-33` | 见 P1-B1/B2/B3，补充：`npm ci` 回退、无 lint、clean checkout 的 `git diff --check` 空操作。 |
| P2-R8 | `README.md:10,20,89-91,106` | 徽章/“最新更新”/下载文件名仍为 v2.7.7，package/app 为 2.7.8；“已知问题”为空；无 v2.7.8 git tag。建议发版前统一。 |
| P2-R9 | `src/third_party/nim/NIM_Web_SDK_rn.js`（约 992KB） | 当前文件有 VERSION 9.21.14/Git Hash 头，但无完整 license/来源说明，仍是压缩第三方单文件，供应链可审查性差。建议补 LICENSE 和来源/校验文档。 |
| P2-R10 | `_internal/`、历史基线 `README.md:109` | 原基线公开过 `8.163.75.157`、`/root/member_db_relay/run.sh`、deploy key 名称、010Push 部署信息；当前 public HEAD 已清理，但 `_internal/` 仍保留这些内容，必须确保永不提交。 |

### 4.6 死代码与工程指标（P3）

- **P3-1 死代码约 680 行**：`src/components/CoverScrim.tsx`、`GlassBackground.tsx`、`LiquidGlass.tsx`、`PageBackdrop.tsx`、`src/hooks/usePaginator.ts`、`navigation/tabBarStyle.ts`、`player/PlayerScreen.tsx`、`services/pocketNim/index.ts`、`theme/radii.ts`、`utils/crashLog.ts` 均无引用；`grep crashLog` 全 src 无引用。
- **P3-2 死 API**：`src/theme/colors.ts:104-115` 的 `Colors`/`DarkColors`、`src/theme/ui.ts`（未从 theme/index 导出）、`GlassSurface.tsx:199 const useAgsL = false && ...` 死分支。
- **P3-3 未使用样式**：`node scripts/unused-styles-check.js` 扫 104 文件，18 个未使用样式全在 `src/screens/SettingsScreen.tsx`：`aboutBrief`、`aboutLogoSmall`、`aboutLogoSmallImg`、`aboutNameSmall`、`aboutVersion`、`checkPill`、`checkPillText`、`donateSheet`、`donateHead`、`donateQr`、`donatePlaceholder`、`donatePlaceholderText`、`donateNote`、`donateActions`、`feedbackSheet`、`feedbackKinds`、`feedbackKindChip`、`feedbackInput`。
- **P3-4 i18n 缺失**：`check-i18n-coverage.js` 844 key 缺 4（`反馈内容已复制`、`个性化设置`、`检查更新失败，请稍后重试`、`小窗、通知与首页模块`），`i18n-full-coverage.js` 862 key/6 缺失（另有 `[链接消息]`、`未知错误`），全部同时缺 zh-Hant/en/ja/ko。
- **P3-5 accessibility 覆盖率低**：`accessibilityLabel/Role/Hint` 51 处 vs `<Touchable*/Pressable>` 212 处（约 24%）。
- **P3-6 硬编码颜色**：tsx 内 hex + rgba 共 448 处，热点 `PlayerChrome.tsx` 62、`FollowedRoomsScreen.tsx` 55、`MediaScreen.tsx` 40、`DanmakuListSheet.tsx` 31、`CoverArt.tsx` 26，主题 token 未完全落地。
- **P3-7 console 与 eslint-disable**：`console.*` 96 处、`eslint-disable` 55 处（next-line 54）；`metro/babel` 未配置 release 去 console。建议 runtimeLog 统一接管并提供 release 级别。
- **P3-8 注释/文档不一致**：`App.tsx:38-54` SafeAreaBridge 注释称“不链接原生 safe-area 包”，但 `android/settings.gradle:38-41` 手动 include、`app/build.gradle:266-267` implementation；`MainApplication.kt:50-51` 也手动注册 `SafeAreaContextPackage`。建议更新注释。
- **P3-9 硬编码 UA/魔法值**：UA 字符串在 `App.tsx:114`、`MediaProbe.ts:19`、`FollowedRoomsScreen.tsx:152/468/3172`、`MusicLibraryScreen.tsx:459/835`、`MediaScreen.tsx:325/421/2021`、`downloads.ts:203`、`MiniPlayer.tsx:433`、`musicPlayer.ts:77/825`、`shareImage.ts:10`、`sharePage.ts:16`、`streamResolver.ts:129` 等 20+ 处重复；`constants/index.ts:46` 的 `USER_AGENT` 反未引用。建议统一函数并区分 iOS/Android profile。
- **P3-10 脚本一次性产物**：`new-keys.json` 77KB、`new-keys2.json` 12KB 等数据转储；大量 `add-theme-imports.js`、`glass-*-codemod.js`、`merge-i18n.js`、`qa-*.js` 一次性脚本位于 `scripts/`，建议归档到工具目录并从发布 checkout 排除。

---

## 五、规范性审查结论

### 1. 优点（应保留）

1. `src/utils/network.ts` 的 `parseResponse` 用 `:\s*([0-9]{15,})\s*([,}\]])` 把大整数先转字符串，避免 JS 精度丢失；GET 缓存/去重、错误分类都较完整（但 body 超时需修）。
2. `src/auth/index.ts` 的 WASM 校验链：内联 base64 pin → `assets/2.wasm` verifyWasm → 代理下载后 hash 校验；`src/auth/webviewSigner.tsx` 有单飞、重建节流、后台等待。
3. `ApkUpdaterModule.java` 下载后 `getPackageArchiveInfo` 校验包名、`verifyApkSigner` 比对证书 SHA-256、安装前再验一次；`ApkUpdaterModule.java:255-275` 仍有集合交集弱点，但整体方向正确。
4. `SecureVaultModule.java` 使用 AndroidKeyStore AES-256-GCM、随机 IV、不绑用户认证；`settings.ts` 有历史明文迁移与 secret 字段分离（fail-open 需改）。
5. `downloads.ts` 的 `withDownloadWrite` 写盘串行化、`sanitizeName`、4GB LRU、m3u8 明确拒绝，都是良好实践；P0-1 是读取层设计缺陷，不是整个下载模块不可用。
6. `test:core` 23 个 Node 测试脚本真实加载 `src` 并断言房间消息、私信图片、注册登录、歌词解析等核心逻辑，实测全部通过；这是项目最扎实的质量资产。
7. 主题/组件库有 `usePalette`、`GlassSurface`、`PerfFlatList` 等统一封装；问题主要是 token 未落地和局部重复，不是全无设计系统。
8. `App.tsx` 有全局 ErrorUtils、RuntimeLog、前台服务桥等启动兜底；`android` 对 ColorOS/后台播放/媒体按钮做了较多兼容处理。

### 2. 质量指标（实测）

| 指标 | 结果 |
|---|---|
| `npm run typecheck` | 通过（`tsc --noEmit` + `verify-version`，v2.7.8/3000011），exit 0 |
| `npm run test:core` | 23 个 Node 测试脚本全部通过，exit 0；无 UI/E2E/覆盖率门禁 |
| 源文件规模 | 208 个 ts/tsx，49,174 行 |
| >500 行文件 | 23 个；最大 `FollowedRoomsScreen.tsx` 4,634 行、`MediaScreen.tsx` 2,723、`src/api/pocket48.ts` 2,071 |
| `: any` / `as any` | 630 / 233 处 |
| `console.*` | 96 处 |
| `eslint-disable` | 55 处（next-line 54） |
| `useEffect` / `useMemo` / `useCallback` | 222 / 58 / 150 |
| 硬编码颜色（tsx hex+rgba） | 448 处 |
| accessibility vs Touchable/Pressable | 51 vs 212（约 24%） |
| i18n | 844 key 缺 4（full 862 key 缺 6），均缺 4 种语言 |
| 未使用样式 | 18 个，全在 `SettingsScreen.tsx` |
| 死代码 | 约 680 行（10 个无引用文件） |
| `npm audit`（官方 registry） | 35 advisories：critical 1、high 15、moderate 13、low 6；多为 Expo/RN CLI 构建链，`node-forge@1.4.2` 直接依赖 4 条 moderate |
| Android 构建验证 | `gradlew :app:assembleRelease --dry-run --offline` 成功（28 tasks up-to-date），未执行完整 `assembleRelease` |

### 3. 规范性问题清单（按影响排序）

1. **没有统一 lint/format**：项目无 ESLint/Prettier 配置、无 lint/format 脚本，CI 也没有；类型检查只能发现类型错误，无法约束 hooks 依赖、未使用变量、浮点 Promise、可访问性等。
2. **TypeScript 严格模式被 `any` 稀释**：`strict: true` 但 630 处 `: any` + 233 处 `as any`，最集中在三大巨型页面和 API 文件。
3. **God Component/God Service**：23 个文件 >500 行，`FollowedRoomsScreen` 4,634 行、`MediaScreen` 2,723 行、`pocket48.ts` 2,071 行；页面同时承担数据请求、分页、轮询、UI、存储和权限，测试和复用困难。
4. **主题 token 未落地**：448 处硬编码颜色；`Colors`/`DarkColors` 死代码；`usePageBackground` 恒 `transparent`。
5. **i18n 覆盖不完整**：6 个 key 全语言缺失；`IdentityDecorations`/`RoomStickerPanel` 等静态 `t` 不随语言变化；`en/ja/ko.ts:98` “关闭”翻译语义错误。
6. **可访问性低**：只有约 24% 的可点击控件有 accessibility 属性；Button/HeaderAction/SearchBar 等基础组件缺语义。
7. **死代码与一次性脚本混杂**：约 680 行无引用源文件；48 个脚本中大量 codemod/审计脚本无入口、无清理；`new-keys*.json` 数据转储进入仓库。
8. **文档/版本不一致**：README v2.7.7 vs package/app 2.7.8；无 v2.7.8 tag；“已知问题”为空；docs 在 public 提交被删除，仅保留 `DESIGN_SYSTEM.md`。
9. **测试结构单一**：23 个脚本级单元测试没有 UI 渲染、导航、原生桥、下载状态机、账号仓、播放器状态机测试；没有覆盖率阈值。
10. **依赖/构建配置漂移**：`app.json` 与 `android/gradle.properties` newArch 冲突；`app.json` 权限列表不完整；`tsconfig` 不检查 scripts/android；`jsc-android` 动态版本；双 ExoPlayer 栈。

---

## 六、建议整改路线

### 第一阶段：发布阻断（必须先做）

1. 修复 P0-1 下载状态机：拆分 `recoverInterruptedDownloads()`，运行期读取不改状态，清理/配额排除活跃任务。
2. 强制 release 签名：`requireReleaseSigning=true` 默认开启，缺 keystore 直接失败；CI 增加 `apksigner verify` 比对生产证书。
3. 修复 P1-C3/C4/C5/C6：secretStore 读取失败不得用空 map；SecureVault 加密失败 fail-closed；accountVault 读取失败拒绝写入，并加写链。
4. 修复 P1-P1/P2/P3/P4：PlayerCore fallback、musicPlayer 切歌暂停、全屏恢复竖屏、视频/音乐 loading 互斥。
5. 修复 P1-P8/P9/P10/P11：RadioForegroundService 前台通知链路、NimQChatClient/NimChatroomClient/PocketNimChatroomModule 生命周期与 Promise。

### 第二阶段：高概率功能错误

1. 网络 body 超时统一化：`network.ts`、`auth/index.ts`、`officialSiteMusic.ts`、`r2Music.ts`、`appUpdate.ts`。
2. 页面请求序列化：BilibiliLive、RoomRadio、MeleeRank、FlipScreen、FollowedRooms。
3. `removeClippedSubviews` 全部移除或 false（PerfFlatList 默认已 false）。
4. `UpdateInstaller` 防重入 + 后台下载取消。
5. Android 原生通知/封面线程/通知 ID/媒体会话一致性。

### 第三阶段：规范化和可维护性

1. 接入 ESLint + Prettier + `eslint-plugin-react-hooks`，CI 强制执行；先以 `warn` 引入，逐步收紧。
2. 把 `FollowedRoomsScreen`、`MediaScreen`、`pocket48.ts`、`PrivateMessagesScreen`、`PlayerChrome` 拆分为领域 hooks/子组件/service。
3. 主题 token 迁移：清理 448 处硬编码颜色，删除 `Colors/DarkColors` 死 API。
4. i18n 全量 key 校验接入 CI（同时匹配 `t(` 和 `translate(`），修复 6 个缺失 key 与 `关闭` 翻译。
5. 基础组件补齐 accessibilityRole/Label/State；建立可访问性 lint。
6. 清理 10 个死文件、18 个未使用样式、一次性脚本和数据转储。
7. 提升测试：下载状态机、账号仓、secretStore、PlayerCore fallback、音乐/视频互斥、导航 remount 加单元/集成测试；配置覆盖率阈值。
8. 统一版本/文档：README 更新 v2.7.8，打 tag，补 release checklist 和已知问题。
9. 依赖治理：升级 okhttp、收敛 ExoPlayer/media3、移除 `jsc-android` 动态版本；`npm audit` 纳入 CI 但区分 dev/build 链风险。

---

## 七、审查覆盖与限制

### 覆盖

- **前端源码**：`src/` 全部 208 个 ts/tsx（含 api、auth、components、hooks、i18n、native、navigation、player、screens、services、store、theme、types、utils、third_party）。
- **Android 原生**：`android/app/src/main/java/com/yk1z/yayamsg/` 下 38 个 Java/Kotlin 文件的核心路径，`AndroidManifest.xml`、`network_security_config.xml`、`file_paths.xml`、`android/app/build.gradle`、`android/build.gradle`、`gradle.properties`、`settings.gradle`、`gradle-wrapper.properties`、`proguard-rules.pro`。
- **工程/脚本**：`package.json`、`app.json`、`tsconfig.json`、`metro.config.js`、`.github/workflows/*`、`scripts/` 全部文件、README、.gitignore、.editorconfig。
- **实测**：typecheck、23 个 test:core、i18n 检查、未使用样式、hooks 顺序、重复代码、`npm audit`、Gradle dry-run。

### 未验证/限制

- 未执行完整 `gradlew assembleRelease`（只做 `--dry-run` 配置级验证）；ABI 冲突未复现，但仍需真实构建确认。
- 未在真机/模拟器运行，未验证 ColorOS 后台冻结、PiP、通知、媒体按钮、NIM 重连等 ROM 行为；相关 Android 结论为静态审查，部分标记为需真机复核。
- 未做 APK 签名篡改实测、未做网络抓包/MITM、未做 DAST。
- 未执行 UI/E2E 测试；页面竞态结论来自代码路径静态分析，建议配合真机复现。
- 审查期间工作区被外部重建为 `public` 分支；报告以当前 HEAD `fb660f4` 为准，删除文件相关的发布脚本风险仅适用于原基线 `5fbb098`/`_internal/`。
- 工作区最终 `git status` 干净；本报告为新增文件，未修改任何源代码。
