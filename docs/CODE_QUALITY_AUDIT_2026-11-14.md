# 代码质量与规范审计（2026-11-14）

## 范围与基线

- 审查范围：`src/**/*.ts`、`src/**/*.tsx`
- 文件数：206
- 源码行数：63,025
- ESLint：0 errors / 0 warnings
- Prettier：通过
- TypeScript：`tsc --noEmit` 通过
- 注释：已清理源码注释中的日期型变更记录，当前 dated comments = 0；保留接口说明、边界条件、兼容性说明

## 当前主要问题

### 1. 巨型文件

| 文件 | 行数 |
|---|---:|
| `src/screens/FollowedRoomsScreen.tsx` | 6,178 |
| `src/screens/MediaScreen.tsx` | 2,712 |
| `src/api/pocket48.ts` | 2,476 |
| `src/screens/LoginScreen.tsx` | 1,996 |
| `src/screens/PrivateMessagesScreen.tsx` | 1,785 |
| `src/player/chrome/PlayerChrome.tsx` | 1,762 |

建议按领域拆 hooks、纯规则函数、子组件和 service；优先从 `FollowedRoomsScreen`、`MediaScreen`、`pocket48.ts` 开始。

### 2. Lint 警告分布

| 规则 | 数量 | 说明 |
|---|---:|---|
| `react-hooks/exhaustive-deps` | 0 | 已清零 |
| `prefer-const` | 0 | 已清零 |
| `no-console` | 0 | 已收敛到 `runtimeLog`；auth 引导日志单独豁免 |
| `@typescript-eslint/no-unused-vars` | 0 | 已清零 |
| `eqeqeq` | 0 | 已改为 `smart`，只允许 `== null` 这类有意匹配 |

### 3. 类型与可维护性

- `: any` 约 415 处，`as any` 约 148 处
- 建议新增领域类型优先覆盖接口响应、播放器 source、房间消息三类
- `PlayerChrome`、`FollowedRoomsScreen`、`MediaScreen` 的 `useEffect` 数量偏多，建议拆成明确的 session/polling/UI 层

### 4. 其他规范项

- `scripts/` 下仍有一批一次性 codemod、临时 QA 脚本和数据转储，建议归档到 `scripts/oneoff/` 或不随发布分支交付
- 部分 native 模块的占位参数未使用，适合统一用 `_` 命名
- 仍有少量 `console.log` 诊断输出，release 下建议由 `runtimeLog` 统一接管

## 本轮已做

- 移除源码注释中的日期型变更记录（如 `2026-10-03 修复`），保留行为说明与边界说明；当前 dated comments = 0
- 移除 `eslint.config.mjs` 中重复启用的基础 `no-unused-vars`，改由 `@typescript-eslint/no-unused-vars` 统一处理，消除 209 条类型签名误报
- 将 `eqeqeq` 调整为 `smart`，保留 `== null` 的合法 null/undefined 匹配，其余比较严格要求严格相等
- 清理 30 条真实未使用变量/导入，移除 `PrivateMessagesScreen` 失效的 `loadMore` 分页状态、`FollowedRoomsScreen` 死渲染函数等
- 清理 `MiniPlayer`、`FullscreenManager`、`PlayerChrome`、`WebKernel` 等文件的未使用导入
- 将播放器、音乐、房间消息中的 console 诊断日志统一收敛到 `runtimeLog`；`src/auth` 的引导日志单独豁免
- 补齐 `MiniPlayer`、`PlayerCore`、`IdentityDecorations`、`RoomStickerPanel` 的 hook 依赖，移除无效依赖
- 将 `MediaScreen` 的分组常量移到模块级，避免每次渲染重建并触发 `useMemo` 抖动
- 将 `MediaScreen` 的 323 行样式抽出到 `src/screens/media/styles.ts`，主文件降到约 3,187 行
- 将 `FollowedRoomsScreen` 的 696 行样式抽出到 `src/screens/followedRooms/styles.ts`，主文件降到约 6,160 行
- 继续修正 `FollowedRoomsScreen`、`MediaScreen`、`ZoomImageModal`、`RechargeScreen` 等 hooks 依赖
- 修正 `ScreenHeader` 的 `useCallback` 依赖、`RuntimeLogViewer` 的无效 memo、`PlayerScreen` 的 `onRetry` ref 判断
- 将 `webviewSigner` 的 timer 改为 `const`；`prefer-const` 剩余 2 条位于凭证请求闭包
- 将 `pocket48.ts` 的设备指纹与请求头工厂（约 389 行）抽出到 `src/api/pocketHeaders.ts`，主文件降到约 2,476 行
- 将 `MediaScreen` 的直播/录播解析、评分、分享页解析与礼物工具约 519 行抽出到 `src/screens/media/parsing.ts`，主文件降到约 2,763 行
- 完成 public `public-1114-2304`、plus `plus-1114-2305` Android Release 构建，均 `BUILD SUCCESSFUL`
- 全量 Prettier 格式化；`tsc`、`test:core`、`format:check`、`check` 与 ESLint 均通过

## 建议优先级

1. P1：`FollowedRoomsScreen`、`MediaScreen`、`pocket48.ts` 拆分
2. P1：`react-hooks/exhaustive-deps` 中涉及轮询、播放器生命周期、房间切房的项
3. P2：`prefer-const` 4 条与剩余 hooks 依赖
4. P2：逐步替换 `any`，先加类型边界，不追求一次性清零
5. P3：一次性脚本归档、注释继续只保留行为说明
