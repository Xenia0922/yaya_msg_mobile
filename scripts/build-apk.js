#!/usr/bin/env node
// Build Android release APK and auto-copy to APK folder with versioned name

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const androidDir = path.join(projectRoot, 'android');
const apkOutputDir = path.join('E:/yymsg/APK');
const pkg = require(path.join(projectRoot, 'package.json'));

function getFeatureDesc() {
  // 从命令行参数读取功能描述，或从最近的 git commit message 取第一行
  const arg = process.argv.find(a => a.startsWith('--desc='));
  if (arg) return arg.split('=')[1].replace(/\s+/g, '-').toLowerCase();
  try {
    const msg = execSync('git log -1 --pretty=%s', { cwd: projectRoot, encoding: 'utf8' }).trim();
    return msg.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '-').toLowerCase().slice(0, 30);
  } catch {
    return 'release';
  }
}

console.log('🔨 Building Android release APK...');
const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
try {
  execSync(`${gradleCmd} assembleRelease`, { cwd: androidDir, stdio: 'inherit' });
} catch (e) {
  console.error('❌ Build failed');
  process.exit(1);
}

const version = pkg.version;
const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const feature = getFeatureDesc();
const srcApk = path.join(androidDir, 'app/build/outputs/apk/release/app-release.apk');
const destName = `yaya-msg-mobile-v${version}-${date}-${feature}.apk`;
const destApk = path.join(apkOutputDir, destName);

if (!fs.existsSync(srcApk)) {
  console.error('❌ APK not found at', srcApk);
  process.exit(1);
}

// Ensure APK output dir exists
if (!fs.existsSync(apkOutputDir)) {
  fs.mkdirSync(apkOutputDir, { recursive: true });
}

fs.copyFileSync(srcApk, destApk);
console.log(`✅ APK copied to: ${destApk}`);
console.log(`   Name: ${destName}`);
console.log(`   Size: ${(fs.statSync(destApk).size / 1024 / 1024).toFixed(1)} MB`);