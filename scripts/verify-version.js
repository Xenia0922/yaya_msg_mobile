#!/usr/bin/env node
/**
 * 版本号四源一致性校验（typecheck 门禁的一部分）：
 *   - package.json           version
 *   - app.json               expo.version / expo.android.versionCode
 *   - android/app/build.gradle versionCode / versionName
 *   - src/constants/index.ts APP_VERSION
 *
 * versionCode 由 Android 发布链路单独维护，必须保持递增；
 * 不再从 versionName 推导，因为同一 2.x 小版本可能有多个修复包。
 * 任意版本名或 versionCode 漂移即 exit 1，防止更新检测/商店版本错位。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fail = (msg) => {
  console.error(`❌ [verify-version] ${msg}`);
  // 立即退出：只设 exitCode 时后面仍会打印“版本一致”，错误日志自相矛盾。
  process.exit(1);
};

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const buildGradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const constants = fs.readFileSync(path.join(root, 'src/constants/index.ts'), 'utf8');

const version = String(pkg.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`package.json version 必须是三段语义版本: ${version}`);
  process.exit(1);
}
if (
  String(packageLock.version || '') !== version ||
  String(packageLock.packages?.['']?.version || '') !== version
) {
  fail(`package-lock.json 根版本与 package.json 不一致: ${packageLock.version || '(empty)'}`);
}
const expectedVersionCode = Number(appJson?.expo?.android?.versionCode || 0);
if (!Number.isInteger(expectedVersionCode) || expectedVersionCode <= 0) {
  fail(`app.json versionCode 无效: ${appJson?.expo?.android?.versionCode}`);
  process.exit(1);
}

// 展示版本：Android versionName / expo.version / APP_VERSION 可用字母后缀区分修复包
// （如 2.7.8），但必须以 package.json 的基础语义版本开头；package.json 自身保持合法 semver。
const displayVersion = String(appJson?.expo?.version || '');
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const displayVersionPattern = new RegExp(`^${escapedVersion}(?:[-.]?[A-Za-z][A-Za-z0-9._-]*)?$`);
if (!displayVersionPattern.test(displayVersion)) {
  fail(
    `app.json expo.version=${displayVersion || '(empty)'} 必须以 package.json ${version} 为基础版本（可带字母后缀，如 ${version}new）`,
  );
}

// 1) app.json
// 2) build.gradle
const vcMatch = buildGradle.match(/versionCode\s+(\d+)/);
if (!vcMatch || Number(vcMatch[1]) !== expectedVersionCode) {
  fail(`app/build.gradle versionCode=${vcMatch?.[1]} ≠ app.json ${expectedVersionCode}`);
}
const vnMatch = buildGradle.match(/versionName\s+"([^"]+)"/);
if (!vnMatch || vnMatch[1] !== displayVersion) {
  fail(`app/build.gradle versionName=${vnMatch?.[1]} ≠ ${displayVersion}`);
}

// 3) APP_VERSION 常量
const avMatch = constants.match(/APP_VERSION\s*=\s*'([^']+)'/);
if (!avMatch || avMatch[1] !== displayVersion) {
  fail(`src/constants/index.ts APP_VERSION=${avMatch?.[1]} ≠ ${displayVersion}`);
}

console.log(
  `✅ [verify-version] 版本一致：v${displayVersion} (versionCode ${expectedVersionCode}, package ${version})`,
);
