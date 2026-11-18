# Release Checklist

1. 更新版本号：
   - `package.json`
   - `package-lock.json`
   - `app.json`（`expo.version` / `expo.android.versionCode`）
   - `android/app/build.gradle`（`versionName` / `versionCode`）
   - `src/constants/index.ts`（`APP_VERSION`）
2. 运行 `npm run verify:version`。
3. 运行质量门禁：
   ```sh
   npm run typecheck
   npm run lint
   npm run format:check
   npm run test:core
   npm run check
   ```
4. 使用发布 keystore 构建：
   - `public` / `plus`
   - `arm64-v8a` / `x86_64`
   - 需要时额外构建 universal
5. 用 `apksigner verify --print-certs` 校验签名，确认证书仍为 `CN=Android Debug`。
6. 生成 `SHA256SUMS-<version>.txt`。
7. 在 MuMu（x86_64）或真机安装验证，确认启动、主要 tab、房间消息、播放器和设置页正常。
8. 在 GitHub Releases 上传 APK、校验和与发布说明，不要上传 keystore 或构建缓存。
