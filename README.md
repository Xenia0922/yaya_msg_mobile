# Yaya Message Mobile

> 口袋48 第三方移动客户端 · React Native 跨平台实现

[![Version](https://img.shields.io/badge/version-2.4.1-ff6f91)](https://github.com/Xenia0922/yaya_msg_mobile)
[![Android](https://img.shields.io/badge/platform-Android-3DDC84?logo=android)](https://github.com/Xenia0922/yaya_msg_mobile)
[![Expo](https://img.shields.io/badge/expo-54-4630EB?logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/react_native-0.81-61DAFB?logo=react)](https://reactnative.dev)
[![License](https://img.shields.io/badge/license-MIT-green)](/LICENSE)

基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg)（[桌面端](https://github.com/yk1z/yaya_msg) / [网页端](https://gnz.hk)）二次开发的移动端版本。

---

## 平台

| 平台 | 状态 |
|:--|:--|
| Android | 正式可用 |
| iOS | 开发中 |
| HarmonyOS | 开发中 |

---

## 功能

- **房间消息** — 关注房间时间线、回复引用、口袋表情与贴纸、礼物感谢文字
- **私信 & 翻牌** — 私信会话、翻牌问答（文字/语音/视频，含七天倒计时与回复耗时）
- **直播 & 回放** — ExoPlayer 原生渲染，RTMP/HLS 多源回退，直播公告实时展示、送礼与贡献榜
- **翻牌统计** — 类型分布、回复耗时分析、成员排名、按成员筛选
- **成员数据库** — 接入官方实时接口，含拼音首字母检索、档案与历史
- **鸡腿充值** — 余额查询、官方充值页内嵌

---

## 构建

### 前置环境

- Node.js ≥ 18
- JDK 17+
- Android SDK（API 34+）

### 安装依赖

```bash
npm install --legacy-peer-deps
```

### 打包 Android APK

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
| 框架 | React Native 0.81 + Expo SDK 54 (bare) |
| 导航 | React Navigation 7 |
| 状态管理 | Zustand |
| 直播引擎 | ExoPlayer (Android) / AVPlayer (iOS / HarmonyOS) |
| 认证 | WebAssembly + WebView fallback |
| 网络 | Pocket48 API（签名 + 非签名双通道） |

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
> [![鲍雨欣](assets/baoyuxin.jpg)](https://github.com/Xenia0922/yaya_msg_mobile)
>
> 献给 **GNZ48 鲍雨欣** —— 因为值得，所以坚持。

---

## 声明

项目仍处于活跃开发阶段，部分功能可能存在缺陷，欢迎 Issue & PR。

**Presented by Xenia**
