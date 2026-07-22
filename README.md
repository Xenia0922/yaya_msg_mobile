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

## 已知问题（Known Issues）

> 以下问题已在 v2.6.2 后续修补版本中修复，记录在此供参考。

### 1. ~~音乐分团标签栏渲染异常~~ ✅ 已修复 (commit `a3aee62`)

- **根因**：FlatList 虚拟化机制在屏幕外 item（CKG/CGT/FAV）进入视口时卸载→重挂载，触发 Yoga 在 Android 上重新测量导致异常拉伸。
- **修复**：FlatList → 纯 ScrollView（`removeClippedSubviews={false}` + `collapsable={false}`），所有标签始终保持挂载；`gap` → `marginRight` 消除额外测量不确定性。

### 2. ~~音乐歌曲卡片无真实封面~~ ✅ 已改进 (commit `a3aee62`)

- **改进**：新增 `findRecordByTitleFuzzy()` 歌名词级模糊匹配 + 跨团全局 records 兜底，大幅提升封面命中率。缓存 key v4→v5 确保立即生效。
- **说明**：部分歌曲在官方 records 中确实无对应封面图，无法 100% 消除渐变占位。跨团匹配已做阈值保守控制以降低错配风险。

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

项目仍处于活跃开发阶段，部分功能可能存在缺陷，欢迎 Issue & PR。

**Presented by Xenia**
