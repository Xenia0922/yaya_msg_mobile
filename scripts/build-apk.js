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
try {
  execSync(`${gradleCmd} assembleRelease`, { cwd: androidDir, stdio: 'inherit' });
} catch (e) {
  console.error('❌ Build failed');
  process.exit(1);
}

const version = pkg.version;
const apkDir = path.join(androidDir, 'app/build/outputs/apk/release');

// v2.6.4 起启用 ABI 分包：arm64-v8a / armeabi-v7a / x86_64 / universal(全量)
const abiSplits = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];

// Ensure APK output dir exists
if (!fs.existsSync(apkOutputDir)) {
  fs.mkdirSync(apkOutputDir, { recursive: true });
}

const copied = [];
const fileExists = f => fs.existsSync(f);

for (const abi of abiSplits) {
  const src = path.join(apkDir, `app-${abi}-release.apk`);
  if (!fileExists(src)) {
    console.warn(`⚠️  Missing split APK for ${abi}`);
    continue;
  }
  const abiTag = abi === 'arm64-v8a' ? 'v8a' : abi === 'x86_64' ? 'x64' : 'v7a';
  const destName = `yaya-msg-mobile-v${version}-${abiTag}.apk`;
  const destApk = path.join(apkOutputDir, destName);
  fs.copyFileSync(src, destApk);
  copied.push({ abi, file: destApk });
}

const universalSrc = path.join(apkDir, 'app-universal-release.apk');
if (fileExists(universalSrc)) {
  const destName = `yaya-msg-mobile-v${version}.apk`;
  const destApk = path.join(apkOutputDir, destName);
  fs.copyFileSync(universalSrc, destApk);
  copied.push({ abi: 'universal', file: destApk });
}

if (copied.length === 0) {
  console.error('❌ No APK found at', apkDir);
  process.exit(1);
}

for (const c of copied) {
  const sizeMB = (fs.statSync(c.file).size / 1024 / 1024).toFixed(1);
  console.log(`✅ [${c.abi}] APK copied to: ${c.file} (${sizeMB} MB)`);
}