<p align="center">
  <img src="assets/banner-v2.svg" width="100%" alt="牙牙消息" />
</p>
<p align="center">
  <img src="assets/logo-rounded.png" width="96" alt="logo" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-ff6f91" alt="license" /></a>
  <a href="https://github.com/Xenia0922/yaya_msg_mobile/releases"><img src="https://img.shields.io/badge/release-v2.7.6-ff6f91" alt="release" /></a>
  <img src="https://img.shields.io/badge/platform-Android-3DDC84?logo=android" alt="Android" />
</p>

# 牙牙消息

口袋48 第三方移动客户端（React Native），基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发。

> **⚠️ v2.7.5 之前的旧版本请卸载后重装；v2.7.5 及之后可直接覆盖安装。**

## 最新更新（v2.7.6，对比 v2.7.5）

**房间 / 礼物**
- 全新礼物面板：礼物图片化展示，挑礼物、送礼物更直观顺手
- 房间内可直接送礼，大小房间都能用
- 礼物榜与贡献榜体验更顺畅

**消息**
- 消息头像支持头像框，粉丝身份等级清晰可见
- 官方表情全面支持
- 语音消息显示时长
- 新增私信未读红点开关
- 消息时间显示优化

**音乐**
- 音乐页性能与稳定性明显提升
- 切歌封面、歌曲时长等显示更准确
- 歌曲卡片样式统一

**更新与推送**
- 支持应用内一键更新，下载更省心
- 新增「010 推送」入口

**其他**
- 鸡腿榜界面优化
- 切换房间更流畅
- 整体使用更稳定、更省电

## 功能

- 房间消息 / 私信 / 翻牌
- 口袋直播与回放
- 公演主播（B站直播）
- 官方音乐库
- 翻牌统计、成员数据库、鸡腿充值

## 安装
从[下载页](https://gnz48.tech/app/)下载

从[夸克网盘](https://pan.quark.cn/s/5b103245218a)下载

从 [Releases](https://github.com/Xenia0922/yaya_msg_mobile/releases) 下载：

- `yaya-msg-mobile-v2.7.6.apk`：通用包（全 ABI，体积最大）
- `yaya-msg-mobile-v2.7.6-x64.apk`：x86_64 模拟器专用
- `yaya-msg-mobile-v2.7.6-v8a.apk` / `-v7a.apk`：真机包（**推荐真机使用**，比通用包小约 60%）

模拟器请用 x64 包，否则无法启动。App 内「检查更新」始终提供通用包直链，真机如需最小体积请在 Release 页面按架构下载。

## 构建

```sh
npm install --legacy-peer-deps
node scripts/build-apk.js
```

## 兼容

鸿蒙 2/3/4 与 Android 8.0+（minSdk 26）。

## 已知问题

## 致谢

基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发，感谢原作者的开发与贡献。

## 免责声明

本应用为**非官方第三方客户端**，与丝芭传媒（SNH48 Group）及口袋48官方无任何关联，未获得其授权或认可，请以官方客户端为准。

- 应用展示的直播、视频、音乐、图片、文本等内容的版权归原权利人所有；
- 本应用仅为个人技术学习与交流目的开发，不代表任何官方立场，不保证内容持续可用；
- 请勿将本应用及其中内容用于商业用途或任何盈利活动；
- 使用本应用可能产生的任何风险（含账号安全风险）由使用者自行承担；
- 如内容涉及侵权或您认为不妥，请与仓库维护者联系处理。

