#!/usr/bin/env node
// 生成 src/constants/buildChannel.ts：构建渠道 + 出包标识。
//
// 背景：渠道此前写死在 src/constants/channel.ts，靠人工改字面量。改漏一次就会出现
// 「plus 分支出的包按公开版运行」（权限功能全关、应用内更新被打开），且从包体表面看不出来。
// 现在由构建脚本在打包前写入，CI 与本机共用同一份逻辑，包内可自证是哪个渠道、哪次出包。
//
// 用法：
//   node scripts/write-build-channel.js            # 自动推断（CI 看仓库名，本地看分支）
//   node scripts/write-build-channel.js plus       # 显式指定
//   node scripts/write-build-channel.js --restore  # 恢复默认文件（构建结束后调用）

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const channelFile = path.join(projectRoot, 'src/constants/buildChannel.ts');

const DEFAULT_SOURCE = `// 默认普通版；scripts/write-build-channel.js 在构建时写入所选渠道与出包标识。
export const BUILD_CHANNEL: 'plus' | 'public' = 'public';
/** 出包标识（渠道-MMDD-HHMM）。开发环境为空串，导出日志时省略。 */
export const BUILD_TAG = '';
`;

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot }).toString().trim();
  } catch {
    return '';
  }
}

/** 渠道推断顺序：显式环境变量 → CI 仓库名 → 本地分支。 */
function detectFlavor() {
  const fromEnv = String(process.env.YAYA_FLAVOR || '').trim().toLowerCase();
  if (fromEnv) return fromEnv;
  // 私有出包仓库固定 plus；同名 ci-build 分支在公开仓库里仍是公版
  if (/yaya_msg_mobile_plus$/i.test(String(process.env.GITHUB_REPOSITORY || '').trim())) return 'plus';
  if (currentBranch() === 'plus') return 'plus';
  return 'public';
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function writeBuildChannel(flavor) {
  const normalized = String(flavor || '').trim().toLowerCase();
  if (!['plus', 'public'].includes(normalized)) {
    throw new Error(`构建渠道必须为 plus 或 public，收到：${flavor}`);
  }
  const tag = `${normalized}-${stamp()}`;
  fs.writeFileSync(
    channelFile,
    `// 由 scripts/write-build-channel.js 在构建时生成，请勿手工编辑。\nexport const BUILD_CHANNEL: 'plus' | 'public' = '${normalized}';\n/** 出包标识（渠道-MMDD-HHMM），随日志导出，用于远程确认用户实际运行的包。 */\nexport const BUILD_TAG = '${tag}';\n`,
  );
  return tag;
}

function restoreBuildChannel() {
  fs.writeFileSync(channelFile, DEFAULT_SOURCE);
}

module.exports = { writeBuildChannel, restoreBuildChannel, detectFlavor, channelFile };

if (require.main === module) {
  const arg = String(process.argv[2] || '').trim();
  if (arg === '--restore') {
    restoreBuildChannel();
    console.log('buildChannel.ts 已恢复默认（public）');
  } else {
    const flavor = arg || detectFlavor();
    console.log(`buildChannel.ts ← ${writeBuildChannel(flavor)}`);
  }
}
