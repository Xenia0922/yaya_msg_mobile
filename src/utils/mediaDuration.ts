const SEC_DURATION_KEYS = new Set([
  'duration',
  'audioDuration',
  'voiceDuration',
  'videoDuration',
  'mediaDuration',
  'msgDuration',
  'audioTime',
  'voiceTime',
  'videoTime',
  'audioSeconds',
  'voiceSeconds',
  'videoSeconds',
  'audioLength',
  'voiceLength',
  'videoLength',
  'playTime',
  'totalTime',
]);

const MS_DURATION_KEYS = new Set([
  'dur',
  'durationMs',
  'durationMillis',
  'durationMsTime',
  'audioTimeMs',
  'voiceTimeMs',
  'videoTimeMs',
  'audioLengthMs',
  'voiceLengthMs',
  'videoLengthMs',
  'mediaDurationMs',
  'msgDurationMs',
  'playTimeMs',
  'totalTimeMs',
]);

const MS_KEY_RE = /(?:Ms|Millis|MsTime)$/i;

function readScalar(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v.trim());
  return NaN;
}

function readDurationSec(v: unknown): number {
  const n = readScalar(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 600) return n;
  if (n <= 86400000) return n / 1000;
  return 0;
}

function readDurationMs(v: unknown): number {
  const n = readScalar(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / 1000);
}

function readDuration(v: unknown): number {
  const n = readScalar(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 600) return n;
  if (n <= 86400000) return n / 1000;
  return 0;
}

function pickFromNamedKeys(obj: Record<string, unknown>): number {
  let best = 0;
  for (const [key, v] of Object.entries(obj)) {
    if (!SEC_DURATION_KEYS.has(key) && !MS_DURATION_KEYS.has(key) && !MS_KEY_RE.test(key)) continue;

    const s =
      MS_DURATION_KEYS.has(key) || MS_KEY_RE.test(key) ? readDurationMs(v) : readDurationSec(v);
    if (s > best) best = s;
  }
  return best;
}

export function findMediaDurationSeconds(value: unknown, depth = 0): number {
  if (!value || depth > 6) return 0;
  if (typeof value === 'number' || typeof value === 'string') {
    return readDuration(value);
  }
  if (typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'object' && item) {
        const d = findMediaDurationSeconds(item, depth + 1);
        if (d > 0) return d;
      }
    }
    return 0;
  }
  const fromNamed = pickFromNamedKeys(value as Record<string, unknown>);
  if (fromNamed > 0) return fromNamed;

  for (const child of Object.values(value)) {
    if (typeof child !== 'object' || !child) continue;
    const d = findMediaDurationSeconds(child, depth + 1);
    if (d > 0) return d;
  }
  return 0;
}
