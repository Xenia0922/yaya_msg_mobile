#!/usr/bin/env node
/**
 * 版本号四源一致性校验（typecheck 门禁的一部分）：
 *   - package.json           version
 *   - app.json               expo.version / expo.android.versionCode
 *   - android/app/build.gradle versionCode / versionName
 *   - src/constants/index.ts APP_VERSION
 *
 * versionCode 约定：major*1000000 + minor*10000 + patch（2.6.5 -> 2060005）
 * 任意一处漂移即 exit 1，防止更新检测/商店版本错位。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fail = (msg) => {
  console.error(`❌ [verify-version] ${msg}`);
  process.exitCode = 1;
};

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const buildGradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const constants = fs.readFileSync(path.join(root, 'src/constants/index.ts'), 'utf8');

const version = String(pkg.version || '');
const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
if (!m) { fail(`package.json version 格式异常: ${version}`); process.exit(1); }
const [, major, minor, patch] = m.map(Number);
const expectedVersionCode = major * 1000000 + minor * 10000 + patch;

// 1) app.json
if (String(appJson?.expo?.version || '') !== version) {
  fail(`app.json expo.version=${appJson?.expo?.version} ≠ package.json ${version}`);
}
if (Number(appJson?.expo?.android?.versionCode) !== expectedVersionCode) {
  fail(`app.json versionCode=${appJson?.expo?.android?.versionCode} ≠ 期望 ${expectedVersionCode} (${version})`);
}

// 2) build.gradle
const vcMatch = buildGradle.match(/versionCode\s+(\d+)/);
if (!vcMatch || Number(vcMatch[1]) !== expectedVersionCode) {
  fail(`app/build.gradle versionCode=${vcMatch?.[1]} ≠ 期望 ${expectedVersionCode} (${version})`);
}
const vnMatch = buildGradle.match(/versionName\s+"([^"]+)"/);
if (!vnMatch || vnMatch[1] !== version) {
  fail(`app/build.gradle versionName=${vnMatch?.[1]} ≠ ${version}`);
}

// 3) APP_VERSION 常量
const avMatch = constants.match(/APP_VERSION\s*=\s*'([^']+)'/);
if (!avMatch || avMatch[1] !== version) {
  fail(`src/constants/index.ts APP_VERSION=${avMatch?.[1]} ≠ ${version}`);
}

console.log(`✅ [verify-version] 四源一致：v${version} (versionCode ${expectedVersionCode})`);
