# Security Policy

## 支持版本

当前维护版本：v2.8.x。

## 报告安全问题

请勿在公开 Issue 中提交 token、Cookie、账号密码、keystore 或可复现的账号接管细节。

请通过仓库维护者的私下联系方式报告，并附上：

- 受影响版本
- 复现步骤
- 影响范围
- 必要的脱敏日志

## 凭证与日志

- 客户端凭证使用 AndroidKeyStore 加密存储
- 应用内导出的运行日志会自动脱敏
- 发布包签名必须沿用 `android/app/debug.keystore`（`CN=Android Debug`），不得更换证书
