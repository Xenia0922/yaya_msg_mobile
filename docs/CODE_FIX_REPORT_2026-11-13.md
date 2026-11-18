# 代码规范整改报告

- 项目：yaya_msg-mobile
- 版本：v2.7.8（versionCode 3000012，兼容历史版本覆盖升级）
- 基线：`public` 分支，HEAD `fb660f4 chore: 初始化公开仓库 v2.7.8`
- 整改日期：2026-11-13
- 对应审查报告：[CODE_AUDIT_REPORT_2026-11-13.md](./CODE_AUDIT_REPORT_2026-11-13.md)

## 一、整改结论

本次整改分两轮执行：第一轮以审查报告中的 P0、P1 问题为硬目标，同时补齐 ESLint/Prettier 工程门禁，清理已确认的死代码和 i18n 缺失；第二轮继续清理可安全落地的 P2/P3 债务，完成 release 出包和模拟器冒烟验证。

两轮整改后：

- 审查报告中的 2 个 P0 已全部修复。
- 37 个 P1 问题已全部处理：36 项已在仓库内修复；P1-B4 涉及的本机发布脚本位于未跟踪的 `_internal/scripts`，已增加显式确认和分支/版本校验（不会随公开仓库交付，见「残余风险」）。
- 第二轮完成网络/API、播放器、UI 无障碍、Android 原生、脚本类型检查和类型热点等 P2 整改；`any` 从约 624/228 处降至约 411/134 处，`scripts` 已纳入独立 `tsconfig.scripts.json` 类型检查。
- `npm run typecheck`（含 `typecheck:scripts`）、`npm run test:core`（23 个脚本）、`npm run lint`（0 errors / 379 warnings）、`npm run format:check`、`npm run check` 全部通过。
- Android `assembleRelease` 出包成功：public 普通版与 plus 权限版各产出 v7a/v8a/x64/universal 4 个 APK，共 8 个 2.7.8 包；已在 MuMu Android 15 模拟器完成安装、升级覆盖、启动和核心页面/播放冒烟验证，未发现应用崩溃。
- 历史版本（v2.7.5～v2.7.8）均由 `android/app/debug.keystore` 的 `CN=Android Debug` 证书签名；为保证老用户可直接覆盖升级，2.7.8 release 包沿用同一证书。这属于历史兼容签名，不是新建的企业生产密钥，详见第十节。

## 二、整改目标与完成情况

| 目标 | 完成情况 |
|---|---|
| 修复 2 个 P0 发布阻断问题 | 已完成：下载状态机、release 签名回退 |
| 修复 P1 构建/网络/认证/播放器/页面问题 | 已完成：P1-B1..B3、C1..C11、P1-P1..P11、S1..S11 |
| 建立 lint/format 质量门禁 | 已完成：ESLint 9 + Prettier 3 + CI 接入 |
| 清理死代码、未使用样式、缺失 i18n key | 已完成：删除 8 个死文件、清理 18 个未用样式、补齐 10 个 key |
| 降低类型、可访问性和巨型文件债务 | 部分完成：修复高风险点；`any`、巨型文件、全量可访问性仍为后续工作 |
| 保持行为兼容并通过现有测试 | 已完成：typecheck、23 个 Node 核心测试全部通过 |
| 输出整改记录 | 本文件 |

## 三、P0 修复详情

### 3.1 P0-1 下载状态机数据丢失

原问题：

- `src/services/downloads.ts` 的 `loadDownloadItems()` 每次读取都会把 `downloading`/`queued` 改成 `failed`，正常运行时也会误伤活跃任务。
- 清理逻辑可能删除仍在下载的文件，替换同 URL 任务时旧任务和旧文件处理不完整。

整改：

- `src/services/downloads.ts:137` 的 `loadDownloadItems()` 改为纯读取，不再改状态。
- `src/services/downloads.ts:157` 新增 `recoverInterruptedDownloads()`，只在应用启动时调用一次（`App.tsx:703`）。
- `src/services/downloads.ts:189` 增加 `withDownloadWrite()` 串行化下载记录写操作。
- `src/services/downloads.ts:199-200` 维护 `activeDownloadIds` 与 `activeCancelHandlers`。
- 同 URL 新任务先取消旧任务并删除旧文件（`:244-274`）。
- `deleteDownloadItem()` 先取消活跃下载再删除记录/文件（`:407-410`）。
- `clearFinishedDownloads()` 只清理已完成/失败项，保留活跃任务（`:421-452`）。

### 3.2 P0-2 release 构建静默使用 debug 签名

原问题：

- `android/app/build.gradle` 在缺少 release keystore 时回退到 debug 签名。
- 本地 `npm run build:android` 未强制 release 签名，CI/脚本存在静默发布 debug 签名包的风险。

整改：

- `android/app/build.gradle:80-86`：新增 `hasReleaseSigning` 与 `requireReleaseSigning` 判断，缺少签名且要求 release 签名时直接抛 `GradleException`。
- `android/app/build.gradle:144-168`：release buildType 只在存在 release 签名时使用 `signingConfigs.release`，否则为 `null`，不再回退 debug。
- `package.json` 的 `build:android` 增加 `-Pyaya.requireReleaseSigning=true`。
- `.github/workflows/android-apk.yml` 增加 release keystore secret 校验，缺少 secret 直接失败；assembleRelease 传入 `-Pyaya.requireReleaseSigning=true`。
- `scripts/build-apk.js` 同样传入 `-Pyaya.requireReleaseSigning=true`。
- `README.md` 更新发布说明至 v2.7.8。

## 四、P1 修复详情

### 4.1 构建、发布与 CI

| 编号 | 问题 | 整改结果 |
|---|---|---|
| P1-B1 | lockfile 失败时静默 `npm install` | `android-apk.yml` 改为仅 `npm ci --no-audit --no-fund --legacy-peer-deps`，删除 `|| npm install` |
| P1-B2 | 质量门禁缺少 lint/format | 新增 `eslint.config.mjs`、`.prettierrc`、`.prettierignore` 及 `lint`/`lint:fix`/`format`/`format:check` 脚本；`quality.yml` 增加 Lint 和 Format check |
| P1-B3 | 出包分支绕过质量检查 | `android-apk.yml` 在构建前增加 quality gate，执行 lint、format:check、typecheck、test:core |
| P1-B4 | 旧发布脚本会把旧 APK 改名发布并强制推 tag | 仓库内已不跟踪这些脚本；本机 `_internal/scripts/upload-release-2.7.6.sh` 增加 `--confirm-production`、分支 `public/public-*` 校验和 `package.json` 版本校验；`upload-release-2.7.7-test.sh` 增加 `--confirm-test-release`，Release 默认 `draft:true`、`prerelease:true` |

### 4.2 网络、认证与本地存储

| 编号 | 问题 | 整改结果 |
|---|---|---|
| P1-C1 | 响应体读取不受超时保护 | `src/utils/network.ts:8-33` 使用 Proxy 包装响应，timer 保留到 body 消费完；`requestJson` 的 timer 保留到 `res.text()` 完成（`:112-203`）；`src/auth/index.ts:125-158` 的 `arrayBuffer()` 同样在 body 完成后清 timer；`officialSiteMusic.ts`、`r2Music.ts` 统一走超时请求 |
| P1-C2 | `findSelfHostedUrl` 无超时 | `src/utils/appUpdate.ts` 改用 `fetchWithTimeout(10000)`；`UpdateInstaller` 请求前先进入 checking 状态 |
| P1-C3 | secretStore 读取失败覆盖全部凭据 | `src/services/secretStore.ts:24-40` 读取/解析失败直接抛错；`setSecret` 不再以空 map 为基线（`:53-65`） |
| P1-C4 | 凭据加密失败静默明文落盘 | `secretStore.ts:57-65`、`accountVault.ts:51` 在加密失败或 SecureVault 不可用时 fail-closed，拒绝保存 |
| P1-C5 | accountVault 读取失败按空列表覆盖 | `accountVault.ts:71-82` 解密/解析失败抛错，不再返回空列表 |
| P1-C6 | accountVault 并发写覆盖 | `accountVault.ts:39` 增加 `withVaultWrite()`；`saveCurrentAccount`/`removeSavedAccount` 串行执行（`:89`、`:114`） |
| P1-C7 | WebView 签名器全局状态无 generation | `src/auth/webviewSigner.tsx` 增加实例 id 过滤，旧实例迟到的 ready/error/result 不会影响新实例 |
| P1-C8 | memberData 上游 `updatedAt=0` 永久拒绝 | `src/services/memberData.ts` 将 `updatedAt=0` 视为“无版本信息”，允许上游 fallback |
| P1-C9 | QChat 旧退订误断新连接 | `src/services/pocketNim/qchat.ts` 增加 observe generation，旧 unsub 不再误断新连接 |
| P1-C10 | Chatroom `open()` dispose 后仍创建实例 | `src/services/pocketNim/chatroom.ts` 在 `await` 后二次检查 `disposed` |
| P1-C11 | 聊天身份可被普通文本伪造 | `src/services/pocketNim/codec.ts` 的 `readExt` 不再把 `msg.content` 当作 ext，仅信任 `remoteExtension` 并校验类型 |

### 4.3 播放器、音频与原生媒体

| 编号 | 问题 | 整改结果 |
|---|---|---|
| P1-P1 | PlayerCore Web 回退标记被渲染期重置 | `src/player/core/PlayerCore.tsx` 改为 `useEffect` 按 source 复位，增加 fallback attempt 守卫；Web 内核失败进入 error |
| P1-P2 | 切歌解析期间旧歌继续播放 | `src/services/musicPlayer.ts` 解析前 pause/stop，增加 `_playSeq`，旧歌词/进度不覆盖新曲 |
| P1-P3 | 全屏卸载不恢复竖屏 | `FullscreenManager.tsx` cleanup 恢复 `PORTRAIT_UP`，关闭前退出全屏 |
| P1-P4 | 视频/小窗与音乐 loading 互斥缺失 | `playerStore.ts`、`miniPlayerStore.ts` 打开外部播放时同时暂停 `loading` 状态 |
| P1-P5 | YayaExoService 队列元数据错配 | 按 index 设置当前曲目元数据，`lastTrack` 随 `onMediaItemTransition` 更新，通知/MediaSession/进度一致 |
| P1-P6 | 同曲暂停分支被注释 | 恢复 `playing=false` 时 `pause()` 分支并处理 `posMs` seek |
| P1-P7 | JS 冻结时本地切歌 hint 不执行 | 本地 hint 优先，不再以 `emitJs()` 返回 true 当作 JS 已处理 |
| P1-P8 | RadioForegroundService 5 秒/ANR 风险 | `onCreate` 创建通知渠道；封面解码移到后台；首次占位通知和 `startForeground` 增加异常保护 |
| P1-P9 | NimQChatClient 重连泄漏旧 session | 重连前 `destroy()` 旧 `qchatSession`，stop/destroy 统一清理 |
| P1-P10 | NimChatroomClient 双 worker | 保存 worker 引用并 join，或用 generation 让旧 worker 永久退出 |
| P1-P11 | PocketNimChatroomModule.send Promise 竞态 | 发送前注册 Promise，使用线程安全 map/统一主线程读写，避免回执丢失和 `ConcurrentModificationException` |

### 4.4 页面、组件与导航

| 编号 | 问题 | 整改结果 |
|---|---|---|
| P1-S1 | BilibiliLiveScreen 切房间无请求序号 | 增加 `watchSeqRef`，旧响应不再覆盖新房间 |
| P1-S2 | RoomRadioScreen 旧响应覆盖新选择 | 增加 `startReqRef`，返回后校验当前选中成员 |
| P1-S3 | MeleeRankScreen 请求竞态与分页污染 | `loadPerson`/`loadMoreRank` 增加请求序号，按周榜 key 校验 |
| P1-S4 | FlipScreen 失败仍推进 pageRef | 请求失败回退 `pageRef`，重试重置分页 |
| P1-S5 | FollowedRooms 轮询闭包过期 | 增加 `liveNowRef`，轮询读取最新直播状态 |
| P1-S6 | FollowedRooms 置顶写序竞态 | `pinnedRef` + `pinnedWriteRef` 串行化写操作 |
| P1-S7 | FollowedRooms 消息分页判断错误 | `getNextTime` 支持 `nextTime` 点路径，并以最早 `msgTime` 兜底 |
| P1-S8 | PrivateMessagesScreen 启用 `removeClippedSubviews` | 删除该属性，避免 Fabric 挂载崩溃 |
| P1-S9 | `withPageMotion(OnMicScreen)` 在渲染体创建 | 改为模块级 `OnMicScreen` 包装，避免整页卸载重挂 |
| P1-S10 | useLiveBarrage 去重窗口建立太晚 | 发送前登记本地消息 key，服务端回投时先命中 |
| P1-S11 | UpdateInstaller 双击并发下载 | 增加单飞锁/`downloadIdRef`，请求前进入 checking，后台下载状态保留 |

## 五、规范与工程质量整改

### 5.1 ESLint / Prettier

新增文件：

- `eslint.config.mjs`：ESLint 9 flat config，接入 `@typescript-eslint`、`eslint-plugin-react`、`react-hooks`、`eslint-config-prettier`。
- `.prettierrc`、`.prettierignore`：统一格式规则。
- `package.json` 新增 `lint`、`lint:fix`、`format`、`format:check`；`lint` 当前为 `eslint src --max-warnings=585`（阈值按实际清理结果逐步收紧）。

规则策略：

- 历史噪声大的规则先降级为 `warn`：`no-unused-vars`、`@typescript-eslint/no-unused-vars`、`react-hooks/exhaustive-deps`、`eqeqeq`、`prefer-const`、`no-console`。
- `@typescript-eslint/no-explicit-any` 暂时关闭，避免一次性改动 800+ 处 `any` 引入行为风险；已列为后续专项。
- CI 当前执行 lint + format:check，保证不新增错误、不新增格式漂移。

结果：

- 初始 lint：2 errors / 771 warnings。
- 两轮整改后：0 errors / 585 warnings，`lint` 通过；较第一轮的 650 条再下降 65 条。
- 全量 Prettier 格式化：253 个已跟踪文件产生内容差异；`format:check` 通过。

### 5.2 死代码与死样式

删除文件：

- `src/components/CoverScrim.tsx`
- `src/components/GlassBackground.tsx`
- `src/components/LiquidGlass.tsx`
- `src/components/PageBackdrop.tsx`
- `src/hooks/usePaginator.ts`
- `src/navigation/tabBarStyle.ts`
- `src/services/pocketNim/index.ts`
- `src/utils/crashLog.ts`

同时清理 SettingsScreen 的 18 个未使用样式、若干未使用导入/常量/函数，以及 `PageBackdrop` 等死引用。

### 5.3 类型、日志与安全

- `src/utils/runtimeLog.ts` 对整行 Cookie 脱敏。
- `src/services/autoCheckin.ts` 不再持久化 token 片段，改为不可逆指纹。
- `src/api/external.ts` 改用泛型 `fetchJson<T>`。
- `src/utils/network.ts` 统一超时与响应体读取。
- `src/screens/MediaScreen.tsx` 直接 `fetch` 改用 `fetchWithTimeout(10000)` 并检查 `resp.ok`。
- `src/services/pocketNim` 的缓存增加 generation/上限：`roomMapCache` 最大 1000 条，`roomMetaCache` 最大 300 条，`roomBgCache`/`liveDecorations` 串行或 generation 防旧回写。
- `src/api/memberData`、`pocketNim`、`room*Cache` 的缓存和 fallback 行为已按审查建议修正。

### 5.4 配置与文档

- `app.json`：`newArchEnabled` 改为 `true`，补齐 `VIBRATE`、`WAKE_LOCK`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`、`POST_NOTIFICATIONS`、`REQUEST_INSTALL_PACKAGES` 权限。
- `README.md` 更新至 v2.7.8。
- `package.json` 的 `build:android` 增加 release 签名强制参数。
- `.github/workflows/quality.yml`、`.github/workflows/android-apk.yml` 增加质量门禁。

### 5.5 i18n

补齐四语言各 10 个缺失 key，包括：

- 链接消息
- 个性化设置
- 切换失败没有拿到登录凭证
- 删除保存账号失败：{msg}
- 反馈内容已复制
- 小窗、通知与首页模块
- 已删除保存的账号
- 昵称修改失败：{msg}
- 未知错误
- 检查更新失败，请稍后重试

`scripts/check-i18n.js` 同步识别 `translate` 调用；i18n 检查通过。

## 六、验证结果

在 `E:\yymsg\_gh_analysis` 执行：

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | exit 0；`tsc --noEmit` 与 `typecheck:scripts` 通过；版本 v2.7.8/3000011 |
| `npm run test:core` | exit 0；23 个 Node 核心测试全部通过 |
| `npm run lint` | exit 0；0 errors / 585 warnings |
| `npm run format:check` | exit 0；全部文件符合 Prettier |
| `npm run check` | exit 0；hooks、i18n（870 keys、0 缺失/0 重复）、unused-styles（0）全部通过 |
| `android\gradlew.bat :app:compileDebugKotlin :app:compileDebugJavaWithJavac --offline --no-daemon` | `BUILD SUCCESSFUL`；311 actionable tasks，4 executed，307 up-to-date |
| `npm run build:android:copy`（本地测试签名） | `BUILD SUCCESSFUL in 1m 1s`；739 actionable tasks，57 executed，682 up-to-date；4 个 APK 复制成功 |

说明：

- `flip-answer-status.test.mjs` 因死代码删除不再有 `answerMediaUrl` 标记，已改用 `logFlipAnswer` 标记。
- `member-data-update.test.mjs` 已按“`updatedAt=0` 视为无版本信息”的新语义调整断言。

## 七、残余风险与未完成项

| 项目 | 状态 | 说明 |
|---|---|---|
| P2-A2 `any` 泛滥 | 部分完成 | 第二轮后 `: any` 约 411 处、`as any` 约 134 处（第一轮约 624/228）；`no-explicit-any` 暂关闭，仍需按模块继续替换为领域类型 |
| P2-A3 巨型文件 | 部分完成 | `FollowedRoomsScreen.tsx`、`MediaScreen.tsx`、`src/api/pocket48.ts`、`PrivateMessagesScreen.tsx` 等仍超过 500～7000 行；本轮只做局部修复与类型收窄，未整体拆分 |
| P2-A4 主题兼容导出 | 已完成 | 删除无引用的 `Colors`、`DarkColors`、`usePageBackground` 兼容别名；内部统一使用 `usePalette`/`getPageBackground` |
| P2-A5 硬编码 UA | 已完成 | 16 处硬编码 UA 已全部替换为 `src/constants/index.ts` 的 `USER_AGENT` 常量，仅保留定义处；`src/api/pocket48.ts` 的动态 `PocketFans201807/${APP_VERSION}` 保留 |
| P2-A7 scripts 类型检查 | 已完成 | 新增 `tsconfig.scripts.json` 与 `npm run typecheck:scripts`，排除少量 VM 测试后纳入 `checkJs`/strict 检查 |
| 可访问性 | 部分完成 | 关键按钮、搜索框、弹窗、底栏等已补 `accessibilityLabel/Role/State`；全仓仍未做到逐控件覆盖 |
| P2-P19 cleartext | 已收窄 | `AndroidManifest.xml` 与 `app.json` 改为 `usesCleartextTraffic=false`；`network_security_config.xml` 基础策略 false，仅对 48.cn、bilibili.com、bilivideo.com、bilivideo.cn、hdslb.com、gnz48.tech、yaya-data.pages.dev、meet48.xyz、ckg48.cn 等业务域放行 |
| P2-P20 Android 构建策略 | 保留 | Android lint 关闭、`minifyEnabled=false`、`shrinkResources=false`、动态 `jsc-android` 版本、ExoPlayer 2 与 media3 双栈仍在 |
| P1-B4 `_internal` 脚本 | 部分完成 | 已在本机脚本增加确认/校验，但文件位于 `.gitignore` 的 `_internal`，不会随仓库交付，团队其他机器仍需同步加固或删除 |
| npm audit | 部分改善 | 当前 npm registry 不支持 security advisories API（404 NOT_IMPLEMENTED）；官方 registry 快照 27 vulnerabilities（1 critical、12 high、12 moderate、2 low），`node-forge` 已由 `^1.4.2` 升至 `^1.4.3`（实际 1.4.3），降至 26 条；剩余 2 条 direct moderate 需 Expo 58 大版本，暂缓 |
| 真机/模拟器验证 | 部分完成 | MuMu Android 15 模拟器已完成旧版→2.7.8 覆盖升级、启动、播放器/音乐/下载/设置/翻牌/上麦等无登录冒烟；登录后功能、真实下载、在线直播、E2E 与签名篡改测试仍未覆盖 |
| 生产签名 | 需后续迁移 | 历史版本（v2.7.5～v2.7.8）均由 `android/app/debug.keystore` 的 `CN=Android Debug` 证书签名；2.7.8 为兼容老用户覆盖升级沿用同一证书，不能更换新证书。后续若迁移到企业正式签名，需要单独设计卸载/迁移方案 |
| lint 基线 | 保留 | 当前 `max-warnings=585` 是基线锁定；后续应逐步降低阈值至 0 |

## 八、后续建议

1. **先做真机回归**：重点覆盖下载管理、播放器切歌/全屏/小窗、私信长列表、B 站直播切房、RoomRadio、更新安装、Android 通知与前台服务。
2. **类型专项**：按 `FollowedRoomsScreen`、`MediaScreen`、`PrivateMessagesScreen`、`FollowedRooms/messageUtils` 分模块清除 `any`，每批保持 typecheck + test 通过。
3. **拆分巨型文件**：优先拆 `FollowedRoomsScreen.tsx`、`MediaScreen.tsx`、`PrivateMessagesScreen.tsx` 的 hooks、列表项和纯函数，避免一次性大改。
4. **Android 发布硬化**：恢复 lint；评估开启 minify/shrink；固定 `jsc-android` 版本；收敛 ExoPlayer 双栈；将 cleartext 改为按域名白名单。
5. **可访问性专项**：为按钮/图片/列表项补 `accessibilityLabel`、`accessibilityRole`、`accessibilityState`，并加入 lint 规则。
6. **依赖安全**：在支持 advisories 的官方 npm registry 上运行 `npm audit --omit=dev`，升级 `node-forge` 等直接依赖；CI 增加审计快照。
7. **提交策略**：本次 Prettier 全量格式化造成较大 diff，建议按目录拆分为多个 review 友好的 commit，避免功能改动和格式改动混在一起难以回溯。

## 九、第二轮 P2/P3 整改与出包验证

### 9.1 第二轮整改范围

第二轮在第一轮基础上继续处理可安全落地的 P2/P3 问题，重点如下：

| 模块 | 主要整改 |
|---|---|
| 网络/API | `src/utils/network.ts` 修复 Proxy 的 `Reflect.get(target, prop, target)` 接收者，解决 Node/undici 读取响应体时的私有字段异常；`src/api/r2Music.ts` 统一使用 `fetchWithTimeout(20000)`；`src/screens/MediaScreen.tsx` 的 `getLiveOne` 改走统一 Pocket API；`src/player/resolve/sharePage.ts` 增加 8 秒超时和 `resp.ok` 校验；`src/api/officialMedia.ts` 收紧长整数匹配并移除未使用导入；`src/api/external.ts` 统一为泛型 `fetchJson<T>` |
| 播放器/音频 | `NativeKernel.tsx` 将 `bufferConfig` 放回 react-native-video 顶层 prop；`streamResolver.ts` 集中 `isRtmpUrl`、过滤非媒体 URL 并识别 `format=hls` 等查询参数；替换 `MiniPlayer.tsx`、`radio.ts`、`RoomRadioScreen.tsx` 的重复 rtmp 判断；`bilibiliDanmaku.ts` 增加切房 generation；`musicPlayer.ts` 增加原生切歌 `_playSeq`；`onMicStore.ts` 增加 hydrate 后轮次校验 |
| UI/无障碍 | `AppDialog` 异步异常处理；`AppToast` 重构为消息存在才渲染、2.2 秒后清理，避免退场节点卡死；`GlassSegmented` 空数组 guard；`AppTabBar` 指示器/无障碍；`Pill` 选中对比度；`SettingsScreen`/`UsagePreferencesScreen` 保存失败回滚；补关键按钮、搜索框、弹窗的 `accessibilityLabel/Role/State` |
| Android 原生 | `MainActivity.kt` 保持 `super.onCreate(null)`（RN/Expo 模板要求，避免 Fragment 恢复风险，并补充注释）；`ApkUpdaterModule.java` 签名集合改为严格相等、空集合 fail-closed；核验并保留 P2-P11/P2-P12/P2-P14/P2-P15/P2-P16 已有修复 |
| 脚本/文档/构建 | 新增 `tsconfig.scripts.json` 与 `typecheck:scripts`；`build-apk.js` 去除硬编码路径，支持 `YAYA_APK_OUTPUT`/`YAYA_FLAVOR`/`YAYA_ABIS`/`YAYA_UNIVERSAL`；`check-hooks-order` 失败退出 1；README 更新 v2.7.8；新增 `docs/THIRD_PARTY_NOTICES.md`；`App.tsx` SafeArea 注释修正 |
| 类型债务 | `src/types/index.ts` 新增 `ApiEnvelope<T>`、`WireRecord`、`RoomMessageWire`、`PrivateConversationWire`、`PrivateMessageWire`、`MemberSummary`、`BilibiliUserInfo`；`FollowedRoomsScreen.tsx` 的 `any` 约 127→12，`PrivateMessagesScreen.tsx` 约 55→2；`src/api/pocket48.ts` 统一 `requestJson<ApiEnvelope>` |
| 运行期缺陷 | 模拟器验证中发现并修复：`AppToast` 旧消息永久驻留；`UpdateInstaller` 在 `version` 为空时调用 `buildApkAsset` 抛“非法的版本标签”导致使用偏好/关于页 ErrorBoundary；`messageUtils.getNextTime` 对显式 `nextTime:0` 的翻页语义；`isPlayableMediaUrl` 对 `/stream?url=` 的识别；`responseOk` 对空 `content/data/list` 的误判 |

此外删除了 `PrivateMessagesScreen.tsx` 的 10 个未使用样式，`check:unused-styles:strict` 已降为 0；`_internal/` 已加入 `.gitignore`，本机发布脚本不再出现在公开工作树状态中。

### 9.2 第二次质量门禁结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | exit 0；含 `typecheck:scripts`、verify-version v2.7.8/3000011 |
| `npm run lint` | exit 0；0 errors / 585 warnings（`--max-warnings=585`） |
| `npm run format:check` | exit 0 |
| `npm run test:core` | exit 0；23 个 Node 脚本全部通过 |
| `npm run check` | exit 0；hooks、i18n 870 keys/0 缺失/0 重复、unused-styles 0 |
| `npm run build:android:copy` | `BUILD SUCCESSFUL in 1m 1s`；739 actionable tasks，57 executed，682 up-to-date；4 个 APK 已复制到 `E:\yymsg\APK` |

### 9.3 第二轮 2.7.8 首轮出包记录（已被第十节 2.7.8 替代）

以下为 v2.7.8（versionCode 3000011）的历史出包记录，最终交付包见第十节。

构建使用本地测试 keystore `E:\yymsg\.local-keys\yaya-local-test.keystore`（`CN=Yaya Local Test, OU=QA`，RSA2048）。这只是验证签名，不是生产签名。

| 产物 | 大小 | 时间 |
|---|---:|---|
| `E:\yymsg\APK\yaya-msg-mobile-v2.7.8-v7a.apk` | 58,367,392 bytes（55.7 MB） | 2026-11-13 16:26 |
| `E:\yymsg\APK\yaya-msg-mobile-v2.7.8-v8a.apk` | 70,788,495 bytes（67.5 MB） | 2026-11-13 16:26 |
| `E:\yymsg\APK\yaya-msg-mobile-v2.7.8-x64.apk` | 73,575,607 bytes（70.2 MB） | 2026-11-13 16:26 |
| `E:\yymsg\APK\yaya-msg-mobile-v2.7.8-universal.apk` | 181,067,305 bytes（172.7 MB） | 2026-11-13 16:26 |

x64 包校验：

- `apksigner verify`：v2 签名有效；证书 SHA-256 `774e5bf3f453ab200b86f67a9a466380e053b214bba068b98e78ca32b2e839ca`。
- `aapt dump badging`：package `com.yk1z.yayamsg`，versionCode `3000011`，versionName `2.7.8`，minSdk `26`，targetSdk `36`，native-code `x86_64`。
- APK SHA-256：`7EC7CFBC6440826A10BA4DE59110450A735061355D35FFD92B99070B83F78705`。
- 首次 `npm run build:android:copy` 在 `:app:createBundleReleaseJsAndAssets` 曾因 Metro 进程环境瞬时失败；清理构建临时环境后用 `cmd.exe` 重新执行 `createBundleReleaseJsAndAssets` 成功（1989 modules，约 31 秒），随后完整 `assembleRelease` 成功。该失败不是源码语法/类型错误。

### 9.4 MuMu 模拟器冒烟结果

设备：MuMu 模拟器，`127.0.0.1:7555`，Android 15，x86_64，1080×1920；安装 x64 包后 `adb install -r` 返回 `Success`，启动进程 pid `8438`，`mCurrentFocus=com.yk1z.yayamsg/com.yk1z.yayamsg.MainActivity`。

已观察页面/行为：

- 首页正常渲染：未登入口袋账号提示、成员直播/公演直播空态、快捷入口、最近播放、工具区、底部四个 tab；无登录态下文案和空态正确。
- 直播 tab：直播/录播切换、关注/全部/SNH48/BEJ48/GNZ48 筛选、搜索入口正常。
- 回放：公开回放卡片加载；点击卡片进入播放器，日志显示 `kind=vod`、`kernel=native`、`first frame onReadyForDisplay`，HLS 播放成功（约 4.2 秒首帧）。
- 音乐：专辑列表加载，播放/暂停、进度条、mini player 正常；播放状态下切到其他页面未出现旧版 `彈幕 N 條` 永久悬浮 toast。
- 设置：主题/背景/语言/使用偏好页正常；使用偏好页不再触发 `UpdateInstaller` 的“非法的版本标签”ErrorBoundary。
- Toast 生命周期：在使用偏好页切换“首页私信入口未读红点”后 0.7 秒截图可见“設定已儲存”，3.7 秒截图已完全消失，验证 `AppToast` 不再永久驻留，同时也没有丢失正常 Toast。
- 下载管理：手动下载输入框、新增下载按钮、空态正常。
- 房间 tab、账号登录页、翻牌页、上麦页：未登录提示和空态正常，无崩溃。
- 应用崩溃缓冲区未发现 `com.yk1z.yayamsg` 的 `FATAL EXCEPTION`/`AndroidRuntime`；仅观察到 `uiautomator` 自身退出的 SIGSEGV（`Cmdline: uiautomator`，非应用进程）。

### 9.5 未覆盖与限制

1. 9.3 的 APK 为历史 v2.7.8 本地测试证书记录；最终 v2.7.8 包沿用历史发布证书（`CN=Android Debug`）以保证覆盖升级，签名策略与升级验证见第十节。
2. 未登录，未验证登录、私信、关注房间、翻牌真实数据、上麦连麦、真实下载链接、在线直播和更新安装等依赖账号/后端的能力；这些页面只验证了入口、未登录守卫和空态。
3. 测试时无在线直播流，直播播放未做真实推流验证；回放 VOD 已实际播放。
4. 未执行完整 UI E2E、性能基准、APK 签名篡改测试和多 Android 版本回归；Android 原生改动仍建议在至少一台真机回归通知、前台服务、PiP 和下载。
5. `npm audit` 仍受 registry 不支持 advisories API 限制，无法在本机刷新依赖漏洞快照。

## 十、2.7.8 双渠道正式包与升级兼容验证

### 10.1 版本策略

| 项目 | 值 |
|---|---|
| 应用包名 | `com.yk1z.yayamsg` |
| 显示版本 | `2.7.8`（`app.json`、`android/app/build.gradle`、`src/constants/index.ts`） |
| versionCode | `3000012`（大于上一版 `3000011`，满足 Android 升级条件） |
| npm 包版本 | `2.7.8`（package.json 仍保持合法 semver，由 `verify-version.js` 校验基础版本一致） |
| 构建标签 | public `public-1114-1911`；plus `plus-1114-1913`（2026-11-14 19:11/19:13 最终构建） |

> 最终交付包统一使用显示版本 `2.7.8`，不再使用 `new` 后缀；`versionCode 3000012` 高于历史包 `3000011`，可正常覆盖升级。

### 10.2 升级兼容签名

历史归档的 v2.7.5、v2.7.6、v2.7.7 APK 以及此前 2.7.8 包，签名证书均为：

- DN：`CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US`
- SHA-256：`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`
- 对应本仓库 `android/app/debug.keystore`（alias `androiddebugkey`，RSA 2048，有效期至 2052-05-01）

为保证老用户可以直接覆盖升级、不丢数据，2.7.8 的 release 包显式使用同一 keystore（本地 `release-signing.properties` 指向 `android/app/debug.keystore`，构建命令传入 `RELEASE_*`），而不是新建证书。`android/app/build.gradle` 仍然强制要求 `RELEASE_*` 完整，缺失时直接失败，不会静默产出未签名包。

> 这是“历史兼容签名”，不是新的企业生产密钥。`android/app/debug.keystore` 是 Android 通用调试证书（口令 `android` 属于公开模板），不具备生产密钥的保密性；本方案只用于保证老用户覆盖升级，不能视为安全的正式发布签名。后续若迁移到企业正式签名，必须单独设计卸载/迁移或双签名过渡方案，否则会破坏覆盖升级。

### 10.3 出包结果

构建环境：Windows、JDK 17（`E:\yymsg\sdk\jdk`）、Android SDK 36、Gradle 8.14.3、Node 24.12.0。public 与 plus 分别执行 `npm run build:android:copy`，均 `BUILD SUCCESSFUL`（最终构建 public 1 分 6 秒、plus 1 分 7 秒，739 actionable tasks）。此前 public 曾在 `createBundleReleaseJsAndAssets` 的 sourcemap 合并阶段遇到一次 `JSON.parse` 竞态错误，重试后成功；最终产物来自成功构建。

| 渠道 | 产物 | 大小（bytes） | SHA-256 |
|---|---|---:|---|
| public | `E:\yymsg\APK\yaya-msg-mobile-v2.7.8-v7a.apk` | 58,378,493 | `BEF2E730223A5DEDAD8F82A02C3BD19C92CB004ACA8D33806EDC8F4C71463F2F` |
| public | `E:\yymsg\APK\yaya-msg-mobile-v2.7.8-v8a.apk` | 70,799,594 | `AB94A0F75D4FDE1B10C118F291CCFC07F38AB08D47B6D7DFDFFA4C691CA018D4` |
| public | `E:\yymsg\APK\yaya-msg-mobile-v2.7.8-x64.apk` | 73,586,710 | `C71DA451FFB59733CA4CE6627B97E7CF9D80ABDA4D2114E2CDFF34765A56C385` |
| public | `E:\yymsg\APK\yaya-msg-mobile-v2.7.8-universal.apk` | 181,078,416 | `1151259D7B302D168FEE48155D5EE96F35FD0F3C303AFF768B0DB790FEFB3908` |
| plus | `E:\yymsg\APK\yaya-msg-mobile-plus-v2.7.8-v7a.apk` | 58,378,419 | `FE2EC88797B9F5E25664FCE4587BCBA1107AA5A0F1CB33A2C52BF73DC5D3EE9B` |
| plus | `E:\yymsg\APK\yaya-msg-mobile-plus-v2.7.8-v8a.apk` | 70,799,516 | `4BC8B8EC4DE2B6B6EC9629DEC56E828E2D6D3FB6D5F1A5D71306B835D6726531` |
| plus | `E:\yymsg\APK\yaya-msg-mobile-plus-v2.7.8-x64.apk` | 73,586,636 | `94873C3ED2128D6F61D421EC3E00E8092F203402922F6FF2594032416ECEC551` |
| plus | `E:\yymsg\APK\yaya-msg-mobile-plus-v2.7.8-universal.apk` | 181,078,335 | `FF3E76E6F97617FB43B0C87FDE5D26AA19E2E6BB6DEDED6844E96C110E8A51AD` |

全部 8 个 APK 已用 `aapt dump badging` 与 `apksigner verify --print-certs` 校验：

- package `com.yk1z.yayamsg`、versionCode `3000012`、versionName `2.7.8`、minSdk `26`、targetSdk `36`；
- 签名证书 SHA-256 均为 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`；
- v2 签名验证通过（minSdk 26，v2 已满足 Android 8+ 安装要求）。

### 10.4 旧版本覆盖升级实测

以下为 2026-11-13 17:30 首轮覆盖升级记录；19:53 最终包的覆盖安装复核见 11.3。

在 MuMu Android 15（x86_64，`127.0.0.1:7555`）上执行真实覆盖升级：

1. 卸载测试机当前包，安装归档旧包 `E:\yymsg\_apk_archive\_old\test277\yaya-msg-mobile-v2.7.7-x64.apk`（文件名 v2.7.7，aapt 显示 versionName `2.7.6`、versionCode `3000009`，证书同为 `CN=Android Debug`）。
2. 旧包安装后 `firstInstallTime=2026-11-13 17:30:30`。
3. 直接执行 `adb install -r E:\yymsg\APK\yaya-msg-mobile-v2.7.8-x64.apk`，返回 `Success`，未卸载旧包。
4. 升级后 `versionCode=3000012`、`versionName=2.7.8`；`firstInstallTime` 仍为 `2026-11-13 17:30:30`，`lastUpdateTime` 更新为 `2026-11-13 17:30:34`，证明是覆盖升级而非重装。
5. 再执行 `adb install -r yaya-msg-mobile-plus-v2.7.8-x64.apk` 覆盖 public 包，同样返回 `Success`；plus 运行日志为 `会话开始 · 牙牙消息 v2.7.8 · plus-1113-1728 · android 35`。
6. 启动应用无 `FATAL EXCEPTION`/`AndroidRuntime`，应用进程正常存活，首页渲染正常。

### 10.5 底栏高度修复

用户反馈底部 dock 栏过高。根因是第一轮 `src/components/AppTabBar.tsx` 将 `paddingBottom` 从固定 `16` 改为 `Math.max(insets.bottom, 16)`，在设备 safe-area bottom 为 48dp 时底栏整体抬高。已恢复为固定 `paddingBottom: 16`，删除 `useSafeAreaInsets` 依赖；修复后底栏只比系统底部小横条高出一点。验证截图：`E:\yymsg\.build-tmp\screens\80-upgrade-home.png`。

### 10.6 最终质量门禁

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | exit 0；含 `typecheck:scripts`、verify-version v2.7.8/3000012 |
| `npm run lint` | exit 0；0 errors / 379 warnings（`--max-warnings=585`） |
| `npm run format:check` | exit 0；所有文件符合 Prettier |
| `npm run test:core` | exit 0；23 个 Node 脚本全部通过 |
| `npm run check` | exit 0；hooks、i18n 870 keys/0 缺失/0 重复、unused-styles 0 |
| `npm run build:android:copy`（public/plus） | 均 `BUILD SUCCESSFUL`，共 8 个签名 APK |

### 10.7 剩余风险（2.7.8 交付时）

- `any`/`as any` 仍有约 415/148 处（按当前正则统计）；巨型文件、全量可访问性和 lint 379 warnings 仍属持续治理项。
- 历史兼容签名使用 `CN=Android Debug` 证书，虽然能保证老用户升级，但不是企业级密钥管理方案；后续迁移需专门设计。
- 未覆盖登录后私信、关注房间、翻牌真实数据、上麦连麦、真实下载、在线直播推流和完整 E2E；模拟器已覆盖入口、空态、回放 VOD、音乐播放、设置、下载页与升级流程。
- Android lint 关闭、minify/shrink 关闭、动态 JSC 版本、ExoPlayer/media3 双栈仍保留，需专项评估。

## 十一、续修与交叉核验（2026-11-13 晚间）

### 11.1 本轮新增修复

| 项目 | 文件 | 内容 |
|---|---|---|
| P0-1 残余 | `src/services/downloads.ts` | 新增写路径专用 `loadDownloadItemsForWrite()`：下载记录 JSON 损坏时显式抛错，禁止用空表覆盖整张记录；`scripts/downloads.test.mjs` 增加损坏记录回归断言 |
| P1-C7 | `src/auth/webviewSigner.tsx` | 每次 WebView 重挂载生成新的实例 id 并重建 HTML；旧实例迟到的 ready/error/pa 全部丢弃；wasm 完整性校验通过前不生成 HTML |
| P1-P2 | `src/services/musicPlayer.ts` | `resume()` 解析前先 pause 旧 Exo 实例，解析失败/无解析器时 stop 并进入错误态，避免旧歌继续响 |
| P1-P4 | `src/screens/RoomRadioScreen.tsx` | 电台开播互斥补上音乐 `loading` 状态并置 `idle`，避免音乐解析完成后与电台双路出声 |
| P1-C2/S11 | `src/components/UpdateInstaller.tsx` | `startDownload` 请求前先切 `checking`；`findSelfHostedUrl` 等待期间按钮禁用并显示 spinner |
| 配置一致性 | `app.json` | 补 `SYSTEM_ALERT_WINDOW`，与 Manifest 实际权限对齐，避免 Expo prebuild 丢权限 |
| 构建脚本 | `scripts/build-apk.js` | 构建结束统一 `restoreBuildChannel()`，避免构建中断后把临时出包 tag 留在源码 |
| 公共成员搜索 | `src/components/MemberPicker.tsx` | 搜索框改为带图标/清除按钮的玻璃输入框，选择成员后 `Keyboard.dismiss()`，与房间页成员搜索一致 |
| 规范清理 | `UsagePreferencesScreen.tsx`、`DownloadScreen.tsx`、`RoomAlbumScreen.tsx`、`PhotosScreen.tsx`、`OpenLiveScreen.tsx`、`AboutScreen.tsx`、`DatabaseScreen.tsx`、`InvoiceScreen.tsx` | 删除重复死代码/未使用导入与变量，清理 70+ 条 lint 噪声 |
| 大型页面清理 | `MediaScreen.tsx`、`FollowedRoomsScreen.tsx`、`MusicLibraryScreen.tsx`、`navigation/index.tsx`、`FullScreenPlayer.tsx` | 移除未使用导入、死状态/死回调、无引用变量与死组件，lint 进一步 509 → 410 |
| 巨型文件拆分 | `src/screens/MediaScreen.tsx` → `src/components/MediaCalendarSheet.tsx` | 将录播日历弹层约 135 行及其样式拆为独立组件，MediaScreen 从 3715 行降至 3494 行；组件补齐上/下月、日期、取消、今天等 accessibilityLabel |
| any 替换 | `src/native/RadioExo.ts`、`src/utils/mediaDuration.ts` | 用 `RadioExoNativeModule`、`Record<string, unknown>`、`unknown` 替换原生桥 8 处与媒体时长解析 6 处 `any`，不改变调用协议 |
| hooks 依赖 | `MediaScreen.tsx`、`MusicLibraryScreen.tsx` | 修正 resume effect 的 `playing?.url` 依赖；均衡器动画值改为 `useMemo` 稳定引用并加入 effect 依赖 |
| i18n 响应式 | `src/components/SearchBar.tsx` | 静态 `t` 改 `useI18n`，语言切换时清除按钮文案即时刷新 |

### 11.2 本轮 UI 修复（用户反馈）

- **账号设置页头部对齐**：`LoginScreen.tsx` 的 `ScreenHeader` 位于 16dp 内边距的内容容器内，导致返回按钮/标题整体右移；增加 `marginHorizontal: -16` 抵消后，与「使用偏好」等二级页一致。
- **顶部 Toast 重构**：`AppToast.tsx` 改为图标 + 浅色玻璃卡片（成功绿勾 / 失败红色 / 信息粉），长消息按长度延长到最多 5 秒，退场淡出；成员库同步的长文案不再是一整条黑底横幅。
- **成员搜索 UI 重做**：房间页搜索框改玻璃胶囊，结果列表改为「成员 + N 位」分组头 + 无卡片 iOS 列表（44dp 头像、分隔线、tintSoft 关注按钮），替换原先每行一张深色大卡的样式。
- **键盘收起**：点击搜索框 ×、关闭搜索、从搜索结果进入成员房间时均执行 `Keyboard.dismiss()`；进房同时清空搜索态，修复「带键盘进房、自动聚焦消息输入框」。
- **首页成员直播 banner**：关注/置顶成员优先；不足 4 条时用其他正在直播的成员补齐，最多展示 4 个 banner；支持左右滑动切换，底部指示点同步。
- **分组筛选条颜色**：移除 `GlassSegmentedScroll` 右缘深色渐隐遮罩，避免截断 chip 被压成黑块/颜色异常（用户红圈处）。
- **系统小窗黑屏/裁剪**：`MiniPlayer` 与 `NativeKernel` 的 `react-native-video` 改用 `ViewType.TEXTURE`（TextureView），避免系统 PiP 从 SurfaceView 切换时先黑屏；小窗盖层使用 `contain`，双击放大/缩小不再裁掉画面边缘。
- **录播系统小窗**：`FullscreenManager` 对 VOD 的 `loading/paused` 也保持 PiP 身份，`PlayerScreen` 为 VOD 增加独立 PiP 登记，避免缓冲/暂停瞬间按 Home 不弹。
- **首页 banner 缓存**：接口返回完整空 `liveList` 时立即清空旧列表/旧缓存，不再连续两次空才清空；主播下播后 banner 不再挂上次缓存的直播。
- **关注筛选**：保留全量直播列表 `allLivesRef`，关注 id 晚到/首屏截断时从全量重排；关注昵称经成员库 `matchFollowedMember` 匹配并去掉 `SNH48-`/`GNZ48-` 前缀；MediaScreen「关注」筛选补 `followedNames` 依赖，避免成员库晚到后仍筛不出关注成员。另对齐 Yaya Message X 的关键实现：直播列表请求 `size: 100`（默认页只有 15 条，关注成员可能在服务端就被截断）、`normalizeLiveList` 不在排序前 `slice`。

### 11.3 本轮复核结果

| 命令/项目 | 结果 |
|---|---|
| `npm run typecheck` | exit 0；`tsc --noEmit`、`typecheck:scripts`、verify-version v2.7.8/3000012 通过 |
| `npm run lint` | exit 0；0 errors / 379 warnings（本轮累计从 582 降 205 条） |
| `npm run format:check` | exit 0 |
| `npm run test:core` | exit 0；23 个测试脚本全部通过（含新增下载记录损坏保护断言） |
| `npm run check` | exit 0；i18n 870 keys / 0 缺失 / 0 重复；unused-styles 0 |
| `npm run build:android:copy`（public/plus） | 均 `BUILD SUCCESSFUL`（public 1m6s / plus 1m7s）；8 个 APK 已复制 |
| APK 元数据 | package `com.yk1z.yayamsg`、versionCode `3000012`、versionName `2.7.8`、minSdk 26、targetSdk 36 |
| APK 签名 | 8 个 APK 均为 `CN=Android Debug` / SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`（历史兼容签名，见 10.2 的警告） |
| MuMu Android 12 模拟器（`127.0.0.1:16384`） | public x64 `adb install -r` 成功；plus x64 覆盖安装同样成功，`lastUpdateTime` 更新到 12:00；启动、首页、直播列表与直播播放均正常，无 `FATAL EXCEPTION`/`AndroidRuntime`；最终 plus 运行日志确认包标识 `plus-1114-1200`。系统 PiP 的 Home 键自动化在该模拟器上未成功触发，PiP 修复需真机按 Home 复测 |
| 本轮 UI/功能验证截图 | `E:\yymsg\.build-tmp\screens\101-account-header.png`（账号页头部对齐）、`103-member-search.png`（成员搜索新版）、`toastseq-5.png`（新版成员同步 Toast）、`105-after-enter-room.png`（进房后键盘已收起）、`109-plus-player.png`（录播 VOD 实际播放）、`112-opt-usage-prefs.png`（使用偏好死代码清理后）、`114-filter-row.png`（筛选条颜色修复）、`115-banner-before-swipe.png` / `116-banner-after-swipe.png`（首页 banner 左右滑动）、`120-pip-final-home.png`（含 PiP 修复的最终包启动）、`124-media-live-player.png`（最终包直播播放） |

### 11.4 仍存在的限制

- 登录后私信、关注房间真实数据、翻牌真实数据、上麦连麦、真实下载链接、在线直播推流和完整 E2E 仍未覆盖；本轮模拟器只做了无登录/已登录账号可见页面和成员搜索/进房的冒烟。
- `android/app/debug.keystore` 是公开模板的调试证书，当前 2.7.8 包为保证历史版本覆盖升级沿用它；这不能作为生产安全签名。若未来更换企业证书，必须单独设计覆盖升级/签名迁移方案。
- Android lint 仍关闭、minify/shrink 关闭、动态 JSC 版本和 ExoPlayer/media3 双栈仍在，属于后续专项。
- `docs/CODE_AUDIT_REPORT_2026-11-13.md` 第 5 行“工作区干净”描述的是审查开始时的基线状态，不代表当前工作树；当前仍有 291 项 `git status` 条目（含未跟踪报告/配置），全部未提交，不能把报告当作“已提交发布”的证明。
- 构建环境注意：在 `workspace-write` 低完整性会话里 Gradle 的 file watcher/CMake 会卡在 `react-native-worklets` 原生编译；本轮最终构建是在 `danger-full-access` 下完成，属于运行环境限制，不是源码错误。

## 附录 A：变更规模

- 已跟踪 diff：256 个文件，`+32,208 / -14,148` 行（含大量 Prettier 格式化差异）。
- 新增未跟踪文件：`.prettierrc`、`.prettierignore`、`eslint.config.mjs`、`tsconfig.scripts.json`、`docs/THIRD_PARTY_NOTICES.md`、`docs/CODE_AUDIT_REPORT_2026-11-13.md`、`docs/CODE_FIX_REPORT_2026-11-13.md`。
- 当前工作树未提交，基线仍为 `public`/`fb660f4`。
- 源码规模：`src` 下 201 个 ts/tsx 文件，约 63,011 行；`any`/`as any` 分别约 415/148 处（按当前 `: any`/`as any` 正则统计）。

## 附录 B：问题编号索引

- P0：P0-1 下载状态机；P0-2 release 签名回退。
- P1：B1-B4 构建/CI；C1-C11 网络/认证/存储；P1-P11 播放器/原生；S1-S11 页面/组件。
- P2/P3：详见审查报告 `docs/CODE_AUDIT_REPORT_2026-11-13.md` 第四章、本报告第七节及第九节。
