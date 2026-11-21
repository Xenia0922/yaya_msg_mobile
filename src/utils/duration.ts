const MAX_DURATION_SECONDS = 86400;
const MAX_DURATION_MILLIS = MAX_DURATION_SECONDS * 1000;

export type DurationKind = 'sec' | 'ms';

export function parseDurationSeconds(value: any, kind: DurationKind = 'sec'): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  const maxMs = MAX_DURATION_MILLIS;
  if (kind === 'ms') {
    if (n > maxMs) return 0;
    return Math.round(n / 1000);
  }

  if (n > maxMs) return 0;
  if (n > MAX_DURATION_SECONDS) return Math.round(n / 1000);
  return n;
}
