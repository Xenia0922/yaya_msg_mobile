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
 * 按数值大小归一化时长（核心修复点）：
 *  口袋48 房间语音 / 视频消息的 duration 字段单位不统一（秒或毫秒混用），
 *  之前一律按字段名硬判秒/毫秒，导致以毫秒返回的值被当成秒显示成「30000s」。
 *  这里不再依赖字段名猜单位，而是按数量级判定：
 *   - ≤ 600：视为「秒」（语音 ≤ 60s、短视频 ≤ 10min 都落在此区间，安全）
 *   - ≤ 86400000：视为「毫秒」→ ÷1000
 *   - 更大：视为 Unix 时间戳 / 脏数据 → 丢弃
 *  这样无论服务端返回秒还是毫秒，都能得到正确的秒数。
 */
// 秒字段归一：≤600 当秒（语音 ≤60s、短视频 ≤10min 都落此区间）；>600 视为毫秒 ÷1000；>24h 丢弃。
// 不 round 小数，由调用方（roomMedia）统一 Math.round。
function readDurationSec(v: any): number {
  const n = readScalar(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 600) return n;
  if (n <= 86400000) return n / 1000;
  return 0;
}

// 毫秒字段归一：明确带 Ms 后缀 / 在 MS 白名单 → 一律 ÷1000 成秒并取整。即便 ≤600（如 500ms 短语音）也正确归一成 1s。
function readDurationMs(v: any): number {
  const n = readScalar(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / 1000);
}

// 兼容：无字段名 hint 的顶层裸数值（如 findMediaDurationSeconds 直接传入数字），沿用量级判定
// （≤600 当秒，>600 当毫秒 ÷1000）。仅供顶层 fallback，嵌套对象一律走白名单。
function readDuration(v: any): number {
  const n = readScalar(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 600) return n;
  if (n <= 86400000) return n / 1000;
  return 0;
}

/**
 * 在对象里只认白名单字段（秒字段 / 毫秒字段），取所有命中里的「最大可信秒值」。
 *
 * 不靠未知字段名兜底——口袋48 消息体里混有大量 time/length/seconds 之类数字，
 * 一旦兜底接受就会误命中（例如某字段 2000 被当毫秒归一成 2s，掩盖真实 4s），
 * 正是「外显 2s、实际 4s」这类对不上的根因。
 *
 * 取最大值而非第一个：真实时长一定 ≥ 任何误读的小值（毫秒÷1000 必然偏小），
 * 所以 max 能自动选到正确的秒值。
 */
function pickFromNamedKeys(obj: Record<string, any>): number {
  let best = 0;
  for (const [key, v] of Object.entries(obj)) {
    if (!SEC_DURATION_KEYS.has(key) && !MS_DURATION_KEYS.has(key) && !MS_KEY_RE.test(key)) continue;
    // 毫秒字段走 Ms 归一（÷1000），秒字段走 Sec 归一（≤600 当秒 / >600 当毫秒）；取最大可信秒值
    const s = (MS_DURATION_KEYS.has(key) || MS_KEY_RE.test(key)) ? readDurationMs(v) : readDurationSec(v);
    if (s > best) best = s;
  }
  return best;
}

// 兜底归一后秒值上限：若是 4h 内（14400s），符合房间视频 / 语音的现实边界
const MAX_SECONDS_AS_MS_NORMALIZED = 14400;

export function findMediaDurationSeconds(value: any, depth = 0): number {
  if (!value || depth > 6) return 0;
  if (typeof value === 'number' || typeof value === 'string') {
    return readDuration(value);
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
