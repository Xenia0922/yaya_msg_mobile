const MAX_DURATION_SECONDS = 86400;

/** 把接口返回的时长字段解析为秒：毫秒自动换算，时间戳/非法值返回 0 */
export function parseDurationSeconds(value: any): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > MAX_DURATION_SECONDS * 1000) return 0;
  if (n > MAX_DURATION_SECONDS) return Math.round(n / 1000);
  return n;
}
