# Yaya Message Mobile · 牙牙消息

> 口袋48 第三方移动客户端 · React Native 实现（仅维护 Android）

[![Version](https://img.shields.io/badge/version-2.6.3-ff6f91)](https://github.com/Xenia0922/yaya_msg_mobile)
[![Android](https://img.shields.io/badge/platform-Android-3DDC84?logo=android)](https://github.com/Xenia0922/yaya_msg_mobile)
[![Expo](https://img.shields.io/badge/expo-54-4630EB?logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/react_native-0.81-61DAFB?logo=react)](https://reactnative.dev)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](/LICENSE)

基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发的移动端版本。

---

## 功能一览

- **房间消息** — 时间线、回复引用、口袋表情与贴纸、礼物感谢
- **私信 & 翻牌** — 会话、翻牌问答（文字 / 语音 / 视频）
- **口袋直播 & 回放** — ExoPlayer 渲染，RTMP / HLS / FLV 多源回退，直播公告、送礼与贡献榜
- **B站直播** — 复用同一套播放器外壳，进入自动横屏全屏
- **翻牌统计** — 类型分布、耗时分析、成员排名
- **成员数据库** — 官方实时接口，拼音检索、档案与历史
- **鸡腿充值** — 余额查询、官方充值页
- **音乐库** — 官方源全量歌曲，分团筛选、搜索、播放队列与收藏

---

## 构建

### 环境
Node.js ≥ 18 · JDK 17+ · Android SDK（API 34+）。本地工具链可置于 `sdk/`（含 SDK + Gradle + JDK）。

### 安装与打包
```bash
npm install --legacy-peer-deps

# Release APK
$env:JAVA_HOME = "path\to\jdk"
$env:ANDROID_HOME = "path\to\android\sdk"
cd android
.\gradlew assembleRelease
```
产物：`android/app/build/outputs/apk/release/app-release.apk`

> `scripts/build-apk.js` 会在 `assembleRelease` 后自动复制到 `E:/yymsg/APK/`，按 `package.json` 版本与日期命名。

---

## 技术栈

| 层 | 技术 |
|:--|:--|
| 框架 | React Native 0.81 + Expo SDK 54 (bare) + React 19 |
| 导航 | React Navigation 7 |
| 状态 | Zustand 5 |
| 直播 | react-native-video（ExoPlayer）/ WebView 兜底（hls.js / flv.js） |
| 认证 | WebAssembly + WebView fallback |
| 网络 | Pocket48 API / B站直播 API |

---

## 目录速览

```
src/
├── api/               Pocket48 & B站 接口（officialSiteMusic.ts 音乐源）
├── components/media/  统一播放器外壳 PlayerChrome + WebView 播放器
├── screens/           直播 / B站直播 / 音乐库 等页面
├── store/             Zustand 状态
└── types/             类型定义
```

---

## 已知问题

### 1. 音乐歌曲卡片有概率丢失封面
音乐库部分歌曲在列表中有概率不显示封面，直接留白。并非「无封面」的统一现象，而是偶发丢失；且客户端当前并未做兜底（空白即为空白），此前「确定性渐变 + 音符图标兜底」的描述不准确。待排查封面 URL 拉取 / 匹配逻辑中的偶发丢失。

---

## 致谢

移动端基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发，感谢原作者的开源贡献。

---

## 声明

项目处于活跃开发阶段，部分功能可能存在缺陷（详见「已知问题」），欢迎 Issue & PR。
