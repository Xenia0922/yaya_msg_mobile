<p align="center">
  <img src="assets/banner-v2.svg" width="100%" alt="牙牙消息" />
</p>
<p align="center">
  <img src="assets/logo-rounded.png" width="96" alt="logo" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-ff6f91" alt="license" /></a>
  <a href="https://github.com/Xenia0922/yaya_msg_mobile/releases"><img src="https://img.shields.io/badge/release-v2.9.1-ff6f91" alt="release" /></a>
  <img src="https://img.shields.io/badge/platform-Android-3DDC84?logo=android" alt="Android" />
</p>

# 牙牙消息

口袋48 第三方移动客户端（React Native），基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发。

当前版本：**v2.9.1**

## 功能

- 房间消息、私信、翻牌
- 口袋直播与回放、公演直播
- 官方音乐库
- 成员档案、成员数据库、行程与公演
- 翻牌统计与鸡腿充值

## 安装

- [下载页](https://gnz48.tech/app/)
- [夸克网盘](https://pan.quark.cn/s/5b103245218a)
- [GitHub Releases](https://github.com/Xenia0922/yaya_msg_mobile/releases)

Release 包说明：

- `yaya-msg-mobile-v2.9.1-universal.apk`：通用包（全 ABI，体积最大）
- `yaya-msg-mobile-v2.9.1-v8a.apk`：arm64 真机包（推荐）
- `yaya-msg-mobile-v2.9.1-x64.apk`：x86_64 模拟器包

App 内「检查更新」始终提供通用包直链；真机如需最小体积，请在 Release 页面按架构下载。

## 开发

```sh
npm install --legacy-peer-deps
node scripts/build-apk.js
```

构建产物默认复制到仓库同级的 `APK/`。构建还可通过以下环境变量调整：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `YAYA_APK_OUTPUT` | 仓库同级 `APK/` | APK 输出目录 |
| `YAYA_ABIS` | `arm64-v8a,x86_64` | 逗号分隔的 ABI |
| `YAYA_UNIVERSAL` | `true` | 是否额外构建 universal 包 |

常用检查：

```sh
npm run typecheck
npm run lint
npm run test:core
npm run check
```

## 兼容

鸿蒙 2/3/4 与 Android 8.0+（minSdk 26）。

## 文档与反馈

- [更新记录](CHANGELOG.md)
- [第三方组件说明](docs/THIRD_PARTY_NOTICES.md)
- [问题反馈](https://github.com/Xenia0922/yaya_msg_mobile/issues)

反馈时请附上应用内导出的日志；日志会自动脱敏。

## 致谢

基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发，感谢原作者的开发与贡献。

## 免责声明

本应用为非官方第三方客户端，与丝芭传媒（SNH48 Group）及口袋48官方无任何关联，未获得其授权或认可，请以官方客户端为准。

- 应用展示的直播、视频、音乐、图片、文本等内容版权归原权利人所有；
- 本项目仅用于个人技术学习与交流，不保证内容持续可用；
- 请勿将本应用及内容用于商业用途或盈利活动；
- 使用本应用可能产生的风险（含账号安全风险）由使用者自行承担；
- 如内容涉及侵权，请联系仓库维护者处理。
