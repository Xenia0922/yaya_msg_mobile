# 第三方组件说明（THIRD PARTY NOTICES）

本文件记录随源码仓库分发、但不由 npm 依赖管理的第三方组件，便于审计来源、版本与完整性。
npm 依赖的许可证见各包自带的 LICENSE 及 `package-lock.json`。

## 网易云信 NIM Web SDK for React Native

| 项目 | 内容 |
| --- | --- |
| 组件 | NIM Web SDK for React Native（`NIM_Web_SDK_rn`） |
| 版权/提供方 | 网易云信（NetEase Yunxin） |
| 版本 | `9.21.14` |
| 构建 Git Hash | `9c08c0a4123e032492e29f015ea46ebc78e4bd0c` |
| 构建时间（SDK 头注释） | 5/21/2026, 11:27:59 AM |
| 仓库内路径 | `src/third_party/nim/NIM_Web_SDK_rn.js` |
| 文件大小 | 992,203 字节 |
| SHA-256 | `AB85F1271AA7988567D4A5F594A3FC0043F28CD0D30EA1ACC516800B613ED102` |
| 来源 | 网易云信官方 NIM Web SDK（React Native 构建产物）：https://yunxin.163.com/ |

说明：

- 该文件是官方 SDK 的压缩构建产物，仓库内未做业务逻辑修改；升级时请整体替换并同步更新上表版本、Git Hash、文件大小和 SHA-256。
- SDK 版权归网易云信所有，使用须遵守网易云信 SDK 服务协议及其许可证；本仓库未附带该 SDK 的独立 LICENSE 文件。
- 完整性校验（在仓库根目录执行）：
  - PowerShell：`Get-FileHash src/third_party/nim/NIM_Web_SDK_rn.js -Algorithm SHA256`
  - Linux/macOS：`sha256sum src/third_party/nim/NIM_Web_SDK_rn.js`
- 升级后还应确认文件头包含 `VERSION: 9.21.14` 等版本信息，并与本表核对。

## 其他随源码分发的文件

- `src/third_party/nim/push-notification-ios-stub.js`：本项目编写的 iOS 推送通知空实现（stub），非第三方组件。
