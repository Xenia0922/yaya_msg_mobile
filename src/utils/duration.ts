const MAX_DURATION_SECONDS = 86400;
const MAX_DURATION_MILLIS = MAX_DURATION_SECONDS * 1000;

export type DurationKind = 'sec' | 'ms';

/**
 * 把接口返回的时长字段解析为秒。
 *  - kind === 'sec'（默认）：值域 [1, 86400] 直接返回；[86401, 86400000] 视为罕见误传毫秒 → ÷1000（容忍服务端偶发把秒字段填成 ms 的情况）；更大返回 0。
 *  - kind === 'ms'：值域 [1, 86400000] → ÷1000；更大返回 0。
 */
export function parseDurationSeconds(value: any, kind: DurationKind = 'sec'): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  const maxMs = MAX_DURATION_MILLIS;
  if (kind === 'ms') {
    if (n > maxMs) return 0;
    return Math.round(n / 1000);
  }
  // kind === 'sec'
  if (n > maxMs) return 0;
  if (n > MAX_DURATION_SECONDS) return Math.round(n / 1000);
  return n;
}
