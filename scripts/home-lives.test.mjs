// 首页「成员直播」列表更新决策测试（纯 Node，零新增依赖）。
//
// 为什么必须钉住这一层（用户 2026-10-05 反馈「主页刷新成员直播列表无法刷新」）：
//   成员下播后服务端稳定返回 `liveList: []`，而旧实现在「本地已有旧数据」时对空列表
//   什么都不做 → 已下播成员的卡片永久钉在主页，下拉刷新 / 60s 轮询 / 回前台刷新都清不掉，
//   用户看到的就是「刷新不了」。
//   反过来，若为了清得干净而"见空就清"，遇上服务端限流返回的空壳又会闪空态；
//   若原始有条目却解析不出（字段改名），更不能清空或替换 —— 那是解析异常。
//   三种情况靠肉眼 UI 回归都不可靠（且现在没有成员开播，无法真机复现），只能靠纯函数单测兜住。
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'yaya-home-lives-'));

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ ok: true, name });
  } catch (error) {
    results.push({ ok: false, name, error });
  }
}

try {
  execSync(
    `npx tsc "${join(root, 'src', 'utils', 'homeLivesRules.ts')}" --rootDir "${root}" --outDir "${tmp}" --module commonjs --target es2019 --moduleResolution node --skipLibCheck`,
    { cwd: root, stdio: 'inherit' },
  );
  const mod = await import(`file://${join(tmp, 'src', 'utils', 'homeLivesRules.js')}`);
  const { decideLivesUpdate, EMPTY_CLEAR_STREAK } = mod;
  if (typeof decideLivesUpdate !== 'function') {
    throw new Error('编译产物里没有 decideLivesUpdate —— 拒绝以「通过」结束');
  }

  /** 默认入参：轮询、本地有 3 张卡、还没连续空过 */
  const base = { prevCount: 3, rawLen: 0, nextLen: 0, emptyStreak: 0, authoritative: false };

  await check('有直播 → 替换列表，连续空计数归零', () => {
    const d = decideLivesUpdate({ ...base, rawLen: 4, nextLen: 4, emptyStreak: 5 });
    assert.equal(d.action, 'replace');
    assert.equal(d.emptyStreak, 0);
  });

  await check('服务端真空 + 本地有卡片 + 轮询首次 → 先保留（防抖动误清）', () => {
    const d = decideLivesUpdate(base);
    assert.equal(d.action, 'keep');
    assert.equal(d.emptyStreak, 1, '计数必须 +1，供下一轮确认');
  });

  await check('服务端真空 + 连续第二次 → 清空（僵尸卡片必须消失）', () => {
    const d = decideLivesUpdate({ ...base, emptyStreak: 1 });
    assert.equal(d.action, 'clear');
    assert.equal(d.emptyStreak, 0);
  });

  await check('服务端真空 + 用户主动下拉刷新 → 立即清空（权威结果）', () => {
    const d = decideLivesUpdate({ ...base, authoritative: true });
    assert.equal(d.action, 'clear', '主动刷新时不该还要等第二次');
    assert.equal(d.emptyStreak, 0);
  });

  await check('服务端真空 + 本地本来就空 → 维持空态', () => {
    const d = decideLivesUpdate({ ...base, prevCount: 0 });
    assert.equal(d.action, 'clear');
    assert.equal(d.emptyStreak, 0);
  });

  await check('原始有条目但解析后为 0（字段改名）→ 保留旧数据，绝不替换/清空', () => {
    const d = decideLivesUpdate({ ...base, rawLen: 6, nextLen: 0, emptyStreak: 1 });
    assert.equal(d.action, 'keep', '解析异常时清空会把"有直播"显示成"暂无成员直播"');
    assert.equal(d.emptyStreak, 0, '解析异常不算"真空"，不应累计空计数');
  });

  await check('EMPTY_CLEAR_STREAK 必须 ≥2（一次空不能清）', () => {
    assert.ok(EMPTY_CLEAR_STREAK >= 2, `当前为 ${EMPTY_CLEAR_STREAK}`);
    assert.equal(decideLivesUpdate(base).action, 'keep');
  });

  await check('场景回放：成员下播后卡片应在两轮内消失', () => {
    // 1) 直播中：主页有 2 张卡
    let streak = 0;
    let cards = 2;
    let d = decideLivesUpdate({
      prevCount: cards,
      rawLen: 2,
      nextLen: 2,
      emptyStreak: streak,
      authoritative: false,
    });
    assert.equal(d.action, 'replace');
    streak = d.emptyStreak;
    cards = 2;

    // 2) 下播后的第一轮轮询：服务端空，界面暂时保留（等确认）
    d = decideLivesUpdate({
      prevCount: cards,
      rawLen: 0,
      nextLen: 0,
      emptyStreak: streak,
      authoritative: false,
    });
    streak = d.emptyStreak;
    assert.equal(d.action, 'keep');
    assert.equal(cards, 2, '第一轮仍在展示旧卡片（防服务端抖动）');

    // 3) 第二轮轮询：确认无人开播 → 清空
    d = decideLivesUpdate({
      prevCount: cards,
      rawLen: 0,
      nextLen: 0,
      emptyStreak: streak,
      authoritative: false,
    });
    assert.equal(d.action, 'clear');
    cards = 0;

    // 4) 清空后继续空：保持空态且计数不膨胀
    d = decideLivesUpdate({
      prevCount: cards,
      rawLen: 0,
      nextLen: 0,
      emptyStreak: d.emptyStreak,
      authoritative: false,
    });
    assert.equal(d.action, 'clear');
    assert.equal(d.emptyStreak, 0);
  });

  await check('场景回放：用户下播后立刻下拉刷新 → 不需要等第二轮', () => {
    const d = decideLivesUpdate({
      prevCount: 2,
      rawLen: 0,
      nextLen: 0,
      emptyStreak: 0,
      authoritative: true,
    });
    assert.equal(d.action, 'clear');
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
  if (!r.ok) console.error(r.error);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
