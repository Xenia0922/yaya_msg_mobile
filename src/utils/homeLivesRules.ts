export interface LivesUpdateInput {
  prevCount: number;

  rawLen: number;

  nextLen: number;

  emptyStreak: number;

  authoritative: boolean;
}

export type LivesUpdateAction = 'replace' | 'clear' | 'keep';

export interface LivesUpdateDecision {
  action: LivesUpdateAction;

  emptyStreak: number;

  reason: string;
}

export const EMPTY_CLEAR_STREAK = 2;

export function decideLivesUpdate(input: LivesUpdateInput): LivesUpdateDecision {
  const { prevCount, rawLen, nextLen, emptyStreak, authoritative } = input;

  if (nextLen > 0) {
    return { action: 'replace', emptyStreak: 0, reason: `列表非空(${nextLen})` };
  }

  if (rawLen > 0) {
    return { action: 'keep', emptyStreak: 0, reason: `解析异常 raw=${rawLen} norm=0` };
  }

  if (prevCount === 0) {
    return { action: 'clear', emptyStreak: 0, reason: '本地已空' };
  }
  if (authoritative) {
    return { action: 'clear', emptyStreak: 0, reason: '用户主动刷新' };
  }
  const streak = emptyStreak + 1;
  if (streak >= EMPTY_CLEAR_STREAK) {
    return { action: 'clear', emptyStreak: 0, reason: `连续${streak}次空列表` };
  }

  return {
    action: 'keep',
    emptyStreak: streak,
    reason: `首次空列表(prev=${prevCount})，等下一轮确认`,
  };
}
