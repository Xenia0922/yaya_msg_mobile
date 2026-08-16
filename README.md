<p align="center">
  <img src="assets/banner.svg" width="100%" alt="牙牙消息 — 口袋48 第三方移动客户端" />
</p>
<p align="center">
  <img src="assets/logo.jpg" width="96" alt="logo" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-ff6f91" alt="license: GPL-3.0" /></a>
  <a href="https://github.com/Xenia0922/yaya_msg_mobile/releases"><img src="https://img.shields.io/badge/release-v2.7-22c3a6" alt="最新版本" /></a>
  <img src="https://img.shields.io/badge/platform-Android-3DDC84?logo=android" alt="平台：Android" />
  <img src="https://img.shields.io/badge/runtime-React%20Native%200.81-61DAFB?logo=react" alt="运行时：React Native 0.81" />
  <img src="https://img.shields.io/badge/expo-54-4630EB?logo=expo" alt="Expo SDK 54" />
</p>

# 牙牙消息 — 口袋48 第三方移动客户端

基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发的 React Native 移动端版本。统一 iOS 26 设计语言（大标题顶栏、玻璃卡片、品牌粉），覆盖消息、私信、翻牌、直播、B站直播、音乐等口袋48 全场景。

> 由 Xenia0922 维护。项目处于活跃开发阶段，欢迎 Issue & PR。

## 特性

- **消息与私信**：房间消息时间线、回复引用、口袋表情/贴纸、礼物感谢；私信会话与翻牌（文字 / 语音 / 视频）
- **口袋直播 & 回放**：ExoPlayer 渲染 + RTMP / HLS / FLV 多源回退；直播公告、送礼与贡献榜；录播按日期分组、断点续播
- **B站直播**：同一套 B站风格播放器外壳（悬浮玻璃坞），弹幕实时接入、画质切换、线路自动切换、网页播放器兜底；公演房间封面与场次标题实时展示
- **实时开播检测**：首页「成员直播 / 公演直播」自动轮询，公演直达直播间；直播/录播「关注」tag 智能筛选
- **音乐库**：官方源全量歌曲，分团筛选、搜索、歌词同步、播放队列、收藏与播放记忆（继续播放续播进度）
- **翻牌统计**：类型分布、耗时分析、成员排名
- **成员数据库**：官方实时接口，拼音检索、档案与历史
- **鸡腿充值**：余额查询、官方充值页
- **全局细节**：全站苹方字体、背景图自定义、深浅色主题、多语言（简中 / 繁中 / EN / JA / KO）

## 安装

从 [Releases](https://github.com/Xenia0922/yaya_msg_mobile/releases) 下载 APK：

- **`yaya-msg-mobile-v2.7.apk`**（universal）：包含全部 ABI，任何设备 / 模拟器通用
- **`yaya-msg-mobile-v2.7-x64.apk`**：x86_64 模拟器（MuMu / 雷电等）专用，体积更小
- **`yaya-msg-mobile-v2.7-v8a.apk` / `-v7a.apk`**：arm64 / armv7 真机专用

> 模拟器请选 `-x64` 包，否则会因缺失原生库无法启动（SoLoaderDSONotFound）。

## 兼容性

- **鸿蒙 2 / 3 / 4**（Android 8.0 基座）及 Android 8.0+ 全系：`minSdk 26`
- 字体已转 TrueType 并全局生效，兼容旧系统字体栈
- 横屏播放器退出后自动复位竖屏；所有页面顶栏统一样式

## 从源码构建

```sh
npm install --legacy-peer-deps

# Release APK（四 ABI）
node scripts/build-apk.js
```

产物输出到 `E:/yymsg/APK/`，按 `package.json` 版本命名。手动构建：

```sh
$env:JAVA_HOME = "path\to\jdk"
$env:ANDROID_HOME = "path\to\android\sdk"
cd android
.\gradlew assembleRelease
```

## 技术栈

| 层 | 技术 |
|:--|:--|
| 框架 | React Native 0.81 + Expo SDK 54（bare）+ React 19 |
| 导航 | React Navigation 7 |
| 状态 | Zustand 5（播放器持久化记忆） |
| 直播 | react-native-video（ExoPlayer）/ WebView 兜底（hls.js / flv.js） |
| 弹幕 | B站 WebSocket 直连（zlib 解压）+ DanmakuOverlay |
| 认证 | WebAssembly + WebView fallback |
| 网络 | Pocket48 API / B站直播 API / yaya-data 歌词库 |
| 字体 | 苹方 PingFang SC（打包 TrueType） |

## 目录速览

```
src/
├── api/               Pocket48 & B站 接口（officialSiteMusic.ts 音乐源）
├── components/media/  统一播放器外壳 PlayerChrome + 弹幕 + WebView 播放器
├── screens/           首页 / 直播 / B站直播 / 音乐库 / 账号 等页面
├── services/          音乐引擎 MusicEngine、B站弹幕服务
├── store/             Zustand 状态
├── theme/             iOS 26 设计 token（颜色 / 排版 / 间距 / 圆角 / 动效）
└── types/             类型定义
```

## 发布约定

- 版本号：`src/constants`、`android/app/build.gradle`、`app.json`、`package.json` 四处于发布时同步递增（如 `2.7`）
- tag 格式：`v2.7`
- 产物：四 ABI APK（universal / x64 / v8a / v7a），随 GitHub Release 附上

## 致谢

移动端基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发，感谢原作者的开源贡献。
