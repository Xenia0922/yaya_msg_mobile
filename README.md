<p align="center">
  <img src="assets/banner.svg" width="100%" alt="牙牙消息" />
</p>
<p align="center">
  <img src="assets/logo-rounded.png" width="96" alt="logo" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-ff6f91" alt="license" /></a>
  <a href="https://github.com/Xenia0922/yaya_msg_mobile/releases"><img src="https://img.shields.io/badge/release-v2.7.5-ff6f91" alt="release" /></a>
  <img src="https://img.shields.io/badge/platform-Android-3DDC84?logo=android" alt="Android" />
</p>

# 牙牙消息

口袋48 第三方移动客户端（React Native），基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发。

## 最新更新（v2.7.5，对比 v2.7.4 共 144 个提交）

**房间 / 消息**
- 消息身份重做：每条消息独立成组；非房主成员发言也按成员档案渲染（名字/头像/队标）；皇冠只给房主
- 点头像看资料：成员进「成员档案」，粉丝弹资料卡（可关注 / 私信）
- 房间内搜索：单列行卡结果 + 搜索框原位嵌入工具条（纯聊天记录搜索）
- 语音播放卡液态玻璃化；房间公告进房间不再依赖播放器；发消息立即上屏

**私信**：支持发图与长按删除；日期分隔；消息顺序修正

**上麦 / 电台**：房间内直接开播（音频小胶囊跨页续播）；手动强制重扫；只扫在团成员

**播放器**：弹幕列表抽屉（内容/发送者搜索、发送者榜、录播跳时间、资料卡）；直播公告默认展开可收起；直播断流自动重连；竖屏小窗不再被裁

**翻牌**：整页翻牌统计（概览 / 类型分布 / 成员排名 / 明细）

**性能**：全站图片缩略图（渲染线程 29%→5.9%）；音乐缓存自递归修复（空闲 CPU 129%→7%）；模糊降采样与网格去逐卡玻璃（三星滚动掉帧大头）

## 功能

- 房间消息 / 私信 / 翻牌
- 口袋直播与回放
- 公演主播（B站直播）
- 官方音乐库
- 翻牌统计、成员数据库、鸡腿充值

## 安装
从[下载页](https://010push.a23xyz.xyz/app/)下载

从[夸克网盘](https://pan.quark.cn/s/5b103245218a)下载

从 [Releases](https://github.com/Xenia0922/yaya_msg_mobile/releases) 下载：

- `yaya-msg-mobile-v2.7.5-universal.apk`：通用包（全 ABI，体积最大）
- `yaya-msg-mobile-v2.7.5-x64.apk`：x86_64 模拟器专用
- `yaya-msg-mobile-v2.7.5-v8a.apk` / `-v7a.apk`：真机包（**推荐真机使用**，比通用包小约 40%）

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

