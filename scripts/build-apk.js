#!/usr/bin/env node
// Build Android release APK and auto-copy to APK folder with versioned name

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const androidDir = path.join(projectRoot, 'android');
const apkOutputDir = path.join('E:/yymsg/APK');
const pkg = require(path.join(projectRoot, 'package.json'));

console.log('🔨 Building Android release APK...');
const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
// 出包铁律：必须 parallel=false（沙箱/部分机器上并行会触发 node_modules 库中间文件锁竞争，随机 AccessDenied）
// 快速验证（只出一个 ABI + 不打包 universal）：
//   YAYA_ABIS=x86_64 YAYA_UNIVERSAL=false node scripts/build-apk.js
//   全量 4 包 + Compose dexing 约 15 分钟；单 ABI 约 1-2 分钟
const extraProps = [
  process.env.YAYA_ABIS ? `-Pyaya.abis=${process.env.YAYA_ABIS}` : '',
  process.env.YAYA_UNIVERSAL ? `-Pyaya.universal=${process.env.YAYA_UNIVERSAL}` : '',
].filter(Boolean).join(' ');
const gradleArgs = ['assembleRelease', '-Dorg.gradle.daemon=true', '-Dorg.gradle.parallel=false', extraProps]
  .filter(Boolean)
  .join(' ');
if (extraProps) console.log(`   （附加 gradle 参数：${extraProps}）`);
try {
  execSync(`${gradleCmd} ${gradleArgs}`, {
    cwd: androidDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
  });
} catch (e) {
  console.error('❌ Build failed');
  process.exit(1);
}

const version = pkg.version;
const apkDir = path.join(androidDir, 'app/build/outputs/apk/release');

// 成品名分版：YAYA_FLAVOR=plus → yaya-msg-mobile-plus-v<version>-v8a.apk；
// 不传 → yaya-msg-mobile-v<version>-v8a.apk（普通版）
// ⚠️ 自用权限版保护：plus 分支构建的包**不得**上传到公开仓库的 Release / 网盘 / 下载页。
// 公版与权限版共用同一个 applicationId，权限版一旦流出，任何人都能覆盖安装并解锁私有功能。
try {
  const branch = require('child_process').execSync('git rev-parse --abbrev-ref HEAD', { cwd: path.join(__dirname, '..') }).toString().trim();
  if (branch === 'plus') {
    console.warn('\n⚠️  当前分支为 plus（自用权限版）—— 产物仅供本机使用，禁止上传到公开仓库 Release / 下载页。\n');
  }
} catch { /* ignore */ }

let branch = '';
try { branch = require('child_process').execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot }).toString().trim(); } catch {}
const FLAVOR = String(process.env.YAYA_FLAVOR || (branch === 'plus' ? 'plus' : '')).trim();
const baseName = FLAVOR ? `yaya-msg-mobile-${FLAVOR}` : 'yaya-msg-mobile';
if (FLAVOR) console.log(`   （打包版本：${FLAVOR}）`);

// v2.6.4 起启用 ABI 分包：arm64-v8a / armeabi-v7a / x86_64 / universal(全量)
const abiSplits = (process.env.YAYA_ABIS || 'armeabi-v7a,arm64-v8a,x86_64')
  .split(',').map((abi) => abi.trim()).filter(Boolean);
const universalEnabled = String(process.env.YAYA_UNIVERSAL || 'true').toLowerCase() === 'true';

// Ensure APK output dir exists
if (!fs.existsSync(apkOutputDir)) {
  fs.mkdirSync(apkOutputDir, { recursive: true });
}

const copied = [];
const missing = [];
const fileExists = f => fs.existsSync(f);

for (const abi of abiSplits) {
  const src = path.join(apkDir, `app-${abi}-release.apk`);
  if (!fileExists(src)) {
    missing.push(abi);
    continue;
  }
  const abiTag = abi === 'arm64-v8a' ? 'v8a' : abi === 'x86_64' ? 'x64' : 'v7a';
  const destName = `${baseName}-v${version}-${abiTag}.apk`;
  const destApk = path.join(apkOutputDir, destName);
  fs.copyFileSync(src, destApk);
  copied.push({ abi, file: destApk });
}

const universalSrc = path.join(apkDir, 'app-universal-release.apk');
if (universalEnabled && fileExists(universalSrc)) {
  const destName = `${baseName}-v${version}.apk`;
  const destApk = path.join(apkOutputDir, destName);
  fs.copyFileSync(universalSrc, destApk);
  copied.push({ abi: 'universal', file: destApk });
}

if (missing.length || (universalEnabled && !fileExists(universalSrc))) {
  console.error(`❌ Expected APK output missing: ${[...missing, ...(universalEnabled && !fileExists(universalSrc) ? ['universal'] : [])].join(', ')}`);
  process.exit(1);
}

if (copied.length === 0) {
  console.error('❌ No APK found at', apkDir);
  process.exit(1);
}

for (const c of copied) {
  const sizeMB = (fs.statSync(c.file).size / 1024 / 1024).toFixed(1);
  console.log(`✅ [${c.abi}] APK copied to: ${c.file} (${sizeMB} MB)`);
}
