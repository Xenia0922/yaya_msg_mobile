# Yaya Message Mobile · 牙牙消息

> 口袋48 第三方移动客户端 · React Native 跨平台实现（当前仅维护 Android）

[![Version](https://img.shields.io/badge/version-2.6.2-ff6f91)](https://github.com/Xenia0922/yaya_msg_mobile)
[![Android](https://img.shields.io/badge/platform-Android-3DDC84?logo=android)](https://github.com/Xenia0922/yaya_msg_mobile)
[![Expo](https://img.shields.io/badge/expo-54-4630EB?logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/react_native-0.81-61DAFB?logo=react)](https://reactnative.dev)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](/LICENSE)

基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg)（[桌面端](https://github.com/yk1z/yaya_msg) / [网页端](https://gnz.hk)）二次开发的移动端版本。

---

## 平台状态

| 平台 | 状态 | 说明 |
|:--|:--|:--|
| Android | 正式可用 | 唯一活跃维护平台，Expo bare 构建 |
| iOS | 已剥离 | 2026-07-22 起不再维护 |
| HarmonyOS | 已剥离 | 2026-07-22 起不再维护 |

> 工程仅保留 `android/` 构建链路，已移除 iOS / HarmonyOS 相关依赖与脚本。

---

## 功能一览

- **房间消息** — 关注房间时间线、回复引用、口袋表情与贴纸、礼物感谢文字
- **私信 & 翻牌** — 私信会话、翻牌问答（文字/语音/视频，含七天倒计时与回复耗时）
- **口袋直播 & 回放** — 原生 `react-native-video` / ExoPlayer 渲染，RTMP/HLS/FLV 多源回退，直播公告实时展示、送礼与贡献榜
- **B站直播** — 复用同一套哔哩哔哩风格播放器外壳（顶栏 + 底部控制坞），进入直播间自动横屏全屏，支持线路回退与网页播放器兜底
- **翻牌统计** — 类型分布、回复耗时分析、成员排名、按成员筛选
- **成员数据库** — 接入官方实时接口，含拼音首字母检索、档案与历史
- **鸡腿充值** — 余额查询、官方充值页内嵌
- **音乐库** — 官方源全量歌曲，分团筛选（ALL / SNH48 / GNZ48 / BEJ48 / CKG48 / CGT48 / 收藏）、搜索、播放队列与收藏；无真实封面歌曲以确定性渐变 + 音符图标兜底

---

## 播放器（统一哔哩哔哩风格外壳）

`src/components/media/PlayerChrome.tsx` 提供跨「口袋直播/录播」与「B站直播」复用的播放器外壳：

- **顶栏 `PlayerTopBar`** — 返回、标题/副标题、更多入口
- **底部控制坞 `PlayerBottomBar`** — 播放/暂停 · 进度条（录播）/ 红点直播标识（直播）· 刷新 · 横屏全屏切换 · 更多面板
- **沉浸式控制条** — 点击画面切换显隐，播放中 3 秒无操作自动隐藏；暂停时常驻
- **横屏按钮** — 使用 MaterialCommunityIcons `fullscreen`（一次点击即进入横屏全屏沉浸，再点退出）
- **直播标识** — 红色圆点 `#ff4d4f` + 已播时长，不使用文字标签

> 注：口袋直播/录播与 B站直播共享同一套外壳与自动隐藏逻辑，保证两端视觉与交互一致。

---

## 构建

### 前置环境

- Node.js ≥ 18
- JDK 17+
- Android SDK（API 34+）
- 本地构建工具链可放在 `sdk/`（含 Android SDK + Gradle + JDK），避免污染系统环境

### 安装依赖

```bash
npm install --legacy-peer-deps
```

### 打包 Android APK（Release）

```bash
# Windows PowerShell
$env:JAVA_HOME = "path\to\jdk"
$env:ANDROID_HOME = "path\to\android\sdk"
cd android
.\gradlew assembleRelease
```

产物路径：`android/app/build/outputs/apk/release/app-release.apk`

---

## 技术栈

| 层 | 技术 |
|:--|:--|
| 框架 | React Native 0.81 + Expo SDK 54 (bare) + React 19 |
| 导航 | React Navigation 7 |
| 状态管理 | Zustand 5 |
| 直播引擎 | react-native-video（ExoPlayer 后端，Android） |
| WebView 兜底 | react-native-webview（HLS/FLV via hls.js / flv.js） |
| 认证 | WebAssembly + WebView fallback |
| 网络 | Pocket48 API（签名 + 非签名双通道）/ B站直播 API |

---

## 目录速览

```
src/
├── api/            Pocket48 & B站 接口封装（含 officialSiteMusic.ts 音乐源）
├── components/
│   ├── media/
│   │   ├── PlayerChrome.tsx   # 统一播放器外壳（顶栏/底栏/更多面板）
│   │   └── player.ts          # WebView HTML5 播放器（hls.js / flv.js）
│   └── ...
├── screens/
│   ├── MediaScreen.tsx        # 口袋直播/录播
│   ├── BilibiliLiveScreen.tsx # B站直播（自动横屏 + 沉浸控制条）
│   └── MusicLibraryScreen.tsx # 音乐库（分团标签栏 + 歌曲网格）
├── store/          Zustand 全局状态
└── types/          类型定义
```

---

## 已知问题（Known Issues）· 待修复

> 以下问题在 v2.6.2 发布时**尚未解决**，计划在后续版本修复。记录在此以便继续排查。

### 1. 音乐分团标签栏渲染异常（标签变长 / 高度撑大 / 大块留空）

- **现象**：顶部分团标签栏（ALL / SNH48 / GNZ48 / BEJ48 / CKG48 / CGT48 / 收藏）中，切到后三组（CKG48、CGT48、收藏）时，标签按钮异常变长、整行高度被撑大，搜索栏与歌曲列表之间出现大块上下留空；FAV「收藏(N)」长度也异常超长。前三组（ALL / SNH48 / GNZ48）表现正常。
- **已尝试方案（均复现，未根治）**：
  1. 删 `maxHeight` + 加 `lineHeight` / `includeFontPadding`（commit `185eeee`）→ 引入宽标签回归 + 文字遮挡，无效；
  2. 按文字估算 `chipWidth()` 算死显式宽度（commit `5e71601`）→ 前三按钮文字被挤换行、后三仍拉长，已 `git revert`；
  3. 硬 `width:72` / FAV `width:104` + `gText numberOfLines={1}`（commit `8dd6a03`）→ 后三仍变长；
  4. 标签栏 `ScrollView` 换 `FlatList horizontal` + `getItemLayout` 固定尺寸（commit `f7823b1`）→ 问题依旧。
- **疑似根因**：横向滚动列表里屏幕外子项（后三组）进入视口时 Yoga 重新测量并拉伸，即便有硬 `width`/`height` 或 `getItemLayout` 仍复现。可能与 RN 0.81 / 特定 Yoga 版本在 Android 上的横向列表测量行为，或父容器（搜索栏与列表之间的布局）约束传递有关。
- **待验证方向**：改用非滚动的固定 7 列网格 / 行内绝对定位布局；或排查 dark mode 下某父 StyleSheet 是否触发异常约束；必要时用原生视图或自定义测量绕过 Yoga 横向测量。

### 2. 音乐歌曲卡片无真实封面（大量「空白卡」）

- **现象**：音乐库大量歌曲卡片无封面，仅显示渐变 + 音符图标占位（非真实专辑封面）。用户反馈「空白问题依旧」。
- **根因**：数据源限制。`src/api/officialSiteMusic.ts` 中 `coverUrl = record && record.image ? record.image : ''`，绝大多数歌曲在口袋48官网 records 中匹配不到带图 record（SNH 那批歌曲的 `artist` 字段本身就是错误专辑名，与 records 匹配不上），故无真实封面。此为**数据限制，非渲染 bug**。
- **已做缓解**：客户端用确定性渐变 + 音符图标兜底（自 `185eeee`），并加黑色文字阴影保证音符在任意深浅渐变上可见（`4b51a0e`）。
- **待解方向**：要真封面需改匹配逻辑（用歌曲标题 / 音频分组兜底匹配 record），但存在「张冠李戴配错封面」风险，尚未授权实施。

---

## 致谢

### Desktop

移动端基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发，感谢原作者的开源贡献。桌面端 [GitHub](https://github.com/yk1z/yaya_msg) · 网页端 [gnz.hk](https://gnz.hk)

### 灵感来源

[48tools](https://github.com/duan602728596/48tools) · [msg48](https://msg48.org) · [WebPocket48Assistant](https://github.com/Lawaxi/WebPocket48Assistant) · [Partner48](https://github.com/Akimaylilll/Partner48)

### AI

[OpenAI](https://openai.com) · [DeepSeek](https://deepseek.com)

---

> *"暴雨过后会出现流星！大家好我是 GNZ48 TEAM G 的鲍雨欣！"*
>
> 献给 **GNZ48 鲍雨欣** —— 因为值得，所以坚持。

---

## 声明

项目仍处于活跃开发阶段，部分功能可能存在缺陷（详见上方「已知问题」），欢迎 Issue & PR。

**Presented by Xenia**
