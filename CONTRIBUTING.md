# Contributing

感谢参与牙牙消息移动版。

## 开发环境

- Node.js 22+
- JDK 17
- Android SDK（compileSdk 36 / build-tools 36.0.0）
- 可选：MuMu 模拟器（x86_64）

## 开发流程

```sh
npm install --legacy-peer-deps
npm run typecheck
npm run lint
npm run test:core
```

提交前请确保以上检查通过，并尽量在真实设备或模拟器上验证相关页面。

## Pull Request

- 一个 PR 尽量只处理一个问题
- 描述复现步骤、修复方式和验证结果
- UI 改动请附截图或录屏
- 不要提交 `APK/`、`android/app/build/`、keystore、token、cookie 等本地产物或敏感信息

## Issue

请使用仓库的 Bug / Feature 模板，并附上应用内导出的日志（日志会自动脱敏）。
