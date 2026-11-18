/**
 * 首页「成员直播」列表的更新决策（纯规则，零依赖，可单测）。
 *
 * ── 为什么必须把这层抽出来钉死（用户：「主页刷新成员直播列表无法刷新」）──
 *
 * 原实现的成功分支只有两条：
 * `if (list.length) { setLives(list) }`
 * `else if (livesRef.current.length === 0) { setLives([]) }`
 * 中间那条 `else`（服务端**结构完整但一条直播都没有** + 本地已有数据）是**空操作**。
 *
 * 后果：成员全部下播后，服务端开始稳定返回 `liveList: []`，而主页因为「本地还有旧数据」
 * 永远不采纳这个事实 —— 已下播成员的卡片钉在主页上，**下拉刷新 / 60s 轮询 / 回前台刷新
 * 全都清不掉它**，点进去才发现直播早已结束。用户的体感就是「怎么刷新都不动」。
 *
 * 同时又必须防两类误判（这两类一旦处理错，就会把「有直播」显示成「暂无成员直播」）：
 * 1) 服务端偶发返回 success + 空 liveList（限流/风控/异常）→ 不能一次就清掉旧卡片，
 * 否则会闪一下空态（等下一轮才有数据）。故真空列表需要**连续两次**才确认；
 * 但用户**主动下拉刷新**时按权威结果立即采纳（用户要的就是"现在到底有没有"）。
 * 2) 原始 `liveList` 有条目、归一化后却是 0 条（字段改名 / 标题为空被过滤）→ 这是
 * **解析异常**，既不能替换也不能清空，只能保留旧数据并把日志打出来（否则静默显示空态）。
 */
export interface LivesUpdateInput {
  /** 当前界面上已有的条数 */
  prevCount: number;
  /** 服务端本次返回的 `liveList` 原始条数（调用方已校验为数组） */
  rawLen: number;
  /** 归一化后可展示条数 */
  nextLen: number;
  /** 之前连续「服务端真空列表」的次数 */
  emptyStreak: number;
  /** 是否用户主动刷新（下拉刷新 = 权威结果，立即采纳空态） */
  authoritative: boolean;
}

export type LivesUpdateAction = 'replace' | 'clear' | 'keep';

export interface LivesUpdateDecision {
  action: LivesUpdateAction;
  /** 交给调用方写回的连续空列表计数 */
  emptyStreak: number;
  /** 诊断用原因（会打进 `[home.lives]` 日志） */
  reason: string;
}

/** 服务端真空列表连续达到该次数 → 确认「确实没人开播」，清空旧卡片 */
export const EMPTY_CLEAR_STREAK = 2;

export function decideLivesUpdate(input: LivesUpdateInput): LivesUpdateDecision {
  const { prevCount, rawLen, nextLen, emptyStreak, authoritative } = input;

  // 1) 有可展示数据：以本次服务端结果为准（内容/顺序都在调用方算好）
  if (nextLen > 0) {
    return { action: 'replace', emptyStreak: 0, reason: `列表非空(${nextLen})` };
  }

  // 2) 原始有条目却解析不出：字段结构异常，保留旧数据（绝不清空），并让日志暴露出来
  if (rawLen > 0) {
    return { action: 'keep', emptyStreak: 0, reason: `解析异常 raw=${rawLen} norm=0` };
  }

  // 3) 服务端确实一条直播都没有（rawLen === 0）
  if (prevCount === 0) {
    // 本地本来就空：维持空态，不算异常，计数归零
    return { action: 'clear', emptyStreak: 0, reason: '本地已空' };
  }
  if (authoritative) {
    // 用户主动刷新：他问的就是"现在有没有"，直接按权威结果清空
    return { action: 'clear', emptyStreak: 0, reason: '用户主动刷新' };
  }
  const streak = emptyStreak + 1;
  if (streak >= EMPTY_CLEAR_STREAK) {
    return { action: 'clear', emptyStreak: 0, reason: `连续${streak}次空列表` };
  }
  // 首次真空：可能是服务端抖动，保留旧卡片等下一轮确认（最迟 60s 轮询就会再判一次）
  return {
    action: 'keep',
    emptyStreak: streak,
    reason: `首次空列表(prev=${prevCount})，等下一轮确认`,
  };
}
