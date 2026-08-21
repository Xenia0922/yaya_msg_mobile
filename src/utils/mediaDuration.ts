import { parseDurationSeconds } from './duration';

/**
 * 从一条消息（含 ext/body/bodys 等任意嵌套结构）里捞出「以秒为单位的媒体时长」。
 *
 * 设计要点：
 *  - 单位不统一：服务端对同一字段可能填秒，也可能填毫秒。按字段名 hint 区分（*Ms / *MsTime / *Millis），
 *    没有 hint 但值 > 2h 也按毫秒兜底归一（语音 / 房间视频一般不会超过 2 小时）。
 *  - 不被「time」「seconds」等宽泛字段名误导：单独维护白名单，避免命中消息发送时间戳等非时长字段。
 *  - plausible 上限：秒值 ≤ 86400（即 24 小时），毫秒值 ≤ 86400000（同上）。更大值是 Unix 秒级时间戳（1e9 量级）直接丢弃，不再退回 0 之前那种「3700 显示成 3700 秒」的离谱场面。
 *
 * 返回值始终是「以秒为单位的整数」。失败返回 0。
 */

// 明确「秒」的字段白名单
const SEC_DURATION_KEYS = new Set([
  'duration',
  'audioDuration', 'voiceDuration', 'videoDuration', 'mediaDuration', 'msgDuration',
  'audioTime', 'voiceTime', 'videoTime', 'audioSeconds', 'voiceSeconds', 'videoSeconds',
  'audioLength', 'voiceLength', 'videoLength',
  'playTime', 'totalTime',
]);

// 明确「毫秒」的字段白名单
const MS_DURATION_KEYS = new Set([
  'durationMs', 'durationMillis', 'durationMsTime',
  'audioTimeMs', 'voiceTimeMs', 'videoTimeMs',
  'audioLengthMs', 'voiceLengthMs', 'videoLengthMs',
  'mediaDurationMs', 'msgDurationMs',
  'playTimeMs', 'totalTimeMs',
]);

// 「疑似毫秒」兜底阈值
const LARGE_AS_MS_THRESHOLD_SECONDS = 7200;

// 后缀命中毫秒字段名（如 audioTimeMs / durationMsTime / millis 等）
const MS_KEY_RE = /(?:Ms|Millis|MsTime)$/i;

function readScalar(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v.trim());
  return NaN;
}

/**
 * 在对象里按 「已知毫秒字段 → 已知秒字段」 的优先级挑出最可信的时长。
 * 返回值已经归一为秒。失败返回 0。
 */
function pickFromNamedKeys(obj: Record<string, any>): number {
  // 1) 命中显式毫秒字段
  for (const [key, v] of Object.entries(obj)) {
    if (MS_DURATION_KEYS.has(key) || MS_KEY_RE.test(key)) {
      const s = parseDurationSeconds(v, 'ms');
      if (s > 0) return s;
    }
  }
  // 2) 命中显式秒字段
  for (const [key, v] of Object.entries(obj)) {
    if (SEC_DURATION_KEYS.has(key)) {
      const s = parseDurationSeconds(v, 'sec');
      if (s > 0) return s;
    }
  }
  // 3) 兜底：未命中已知字段名时，挑第一个「值过大疑似毫秒」的字段归一
  for (const [key, v] of Object.entries(obj)) {
    if (MS_DURATION_KEYS.has(key) || SEC_DURATION_KEYS.has(key) || MS_KEY_RE.test(key)) continue;
    const n = readScalar(v);
    if (!Number.isFinite(n) || n <= LARGE_AS_MS_THRESHOLD_SECONDS) continue;
    // 把「大于 2h 阈值」的数字按毫秒处理
    const s = parseDurationSeconds(n, 'ms');
    if (s > 0 && s <= MAX_SECONDS_AS_MS_NORMALIZED) return s;
  }
  return 0;
}

// 兜底归一后秒值上限：若是 4h 内（14400s），符合房间视频 / 语音的现实边界
const MAX_SECONDS_AS_MS_NORMALIZED = 14400;

export function findMediaDurationSeconds(value: any, depth = 0): number {
  if (!value || depth > 6) return 0;
  if (typeof value === 'number' || typeof value === 'string') {
    return parseDurationSeconds(value, 'sec');
  }
  if (typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      // 仅递归对象/数组子节点；number/string 子节点没有 key hint，不能宽松当作「顶层秒值」接受
      if (typeof item === 'object' && item) {
        const d = findMediaDurationSeconds(item, depth + 1);
        if (d > 0) return d;
      }
    }
    return 0;
  }
  const fromNamed = pickFromNamedKeys(value);
  if (fromNamed > 0) return fromNamed;
  // 兜底下钻：只看嵌套对象/数组，不下钻 scalar（避免 `time`/`seconds`/`length` 这种数字子值被当顶层秒值）
  for (const child of Object.values(value)) {
    if (typeof child !== 'object' || !child) continue;
    const d = findMediaDurationSeconds(child, depth + 1);
    if (d > 0) return d;
  }
  return 0;
}
