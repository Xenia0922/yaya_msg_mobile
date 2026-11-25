#!/usr/bin/env node
// 生成 src/constants/buildChannel.ts：构建渠道 + 出包标识。
//
// 由构建脚本在打包前写入，CI 与本机共用同一份逻辑，用于识别构建渠道与批次。
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
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot })
      .toString()
      .trim();
    if (branch && branch !== 'HEAD') return branch;
  } catch {
    /* 继续走 detached HEAD 兜底 */
  }
  // CI 的 detached checkout 由环境变量提供 ref 名。
  const ciRef = String(
    process.env.GITHUB_HEAD_REF ||
      process.env.GITHUB_REF_NAME ||
      process.env.CI_COMMIT_REF_NAME ||
      '',
  )
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '');
  if (ciRef) return ciRef;
  // 本地 detached HEAD：git name-rev 会给出最近的 ref，如 plus~12 / origin/public~3。
  try {
    const name = execSync('git name-rev --name-only HEAD', { cwd: projectRoot })
      .toString()
      .trim()
      .replace(/^remotes\/[^/]+\//, '');
    const first = name.split(/[~^]/)[0];
    if (first && first !== 'undefined') return first;
  } catch {
    /* 无 git 或浅克隆时忽略 */
  }
  return '';
}

function originRepoName() {
  try {
    const url = execSync('git remote get-url origin', { cwd: projectRoot }).toString().trim();
    return (
      url
        .replace(/\.git$/i, '')
        .split(/[/\\:]/)
        .filter(Boolean)
        .pop() || ''
    );
  } catch {
    return '';
  }
}

/** 渠道推断顺序：显式环境变量 → 仓库名（CI 或本地 origin）→ 分支。 */
function detectFlavor() {
  const fromEnv = String(process.env.YAYA_FLAVOR || '')
    .trim()
    .toLowerCase();
  if (fromEnv) return fromEnv;
  // 仓库名以 _plus 结尾时固定 plus，与分支名称或 detached HEAD 无关。
  const repo = String(process.env.GITHUB_REPOSITORY || originRepoName()).trim();
  if (/yaya_msg_mobile_plus$/i.test(repo)) return 'plus';
  const branch = currentBranch();
  if (branch === 'plus') return 'plus';
  // 没有 remote 的本地仓库无法从仓库名判渠道；专用出包分支 ci-build 按 plus 处理。
  if (branch === 'ci-build' && !repo) return 'plus';
  return 'public';
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function writeBuildChannel(flavor) {
  const normalized = String(flavor || '')
    .trim()
    .toLowerCase();
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
