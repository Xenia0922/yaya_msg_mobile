/**
 * 鲁棒弹幕 / LRC 解析器。
 *
 * 痛点：口袋48 的弹幕有两种时间格式混用
 *   - 直播回放风格:  [hh:mm:ss]       或  [hh:mm:ss.xxx]
 *   - 标准 LRC:      [mm:ss]          或  [mm:ss.xx]
 * 且正文常为 `昵称\t内容` 形式。逐行容错，任何一行解析失败都不影响整体。
 */

export interface DanmakuItem {
  /** 出现时间（秒，浮点） */
  time: number;
  /** 弹幕正文（已剥离昵称前缀） */
  text: string;
  /** 若存在 `\t` 分隔的昵称则保留 */
  nick?: string;
}

const TIME_RE = /^\s*\[\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?\s*\]([\s\S]*)$/;

/** 把 hh:mm:ss / mm:ss + 毫秒 解析成秒。毫秒不足 3 位自动补零。 */
function parseTime(h: string, m: string, s: string | undefined, ms: string | undefined): number {
  const hours = s !== undefined ? parseInt(h, 10) : 0;
  const minutes = s !== undefined ? parseInt(m, 10) : parseInt(h, 10);
  const seconds = s !== undefined ? parseInt(s, 10) : parseInt(m, 10);
  // 毫秒：'1' -> 0.1s, '12' -> 0.12s, '123' -> 0.123s
  const millis = ms ? parseInt(ms.padEnd(3, '0'), 10) / 1000 : 0;
  return hours * 3600 + minutes * 60 + seconds + millis;
}

/**
 * 解析一段弹幕 / LRC 文本。
 * @param raw 原始文本（可能来自接口或本地缓存文件，离线同样可用）
 * @returns 按时间升序排列的弹幕数组（解析失败的整行会被跳过）
 */
export function parseDanmaku(raw: string): DanmakuItem[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const result: DanmakuItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(TIME_RE);
    if (!match) continue; // 容错：无时间标签的行直接忽略

    const [, h, m, s, ms, body] = match;
    let text = (body ?? '').trim();
    let nick: string | undefined;

    // `昵称\t内容` 形式：剥离昵称，保留内容
    const tabIdx = text.indexOf('\t');
    if (tabIdx >= 0) {
      nick = text.slice(0, tabIdx).trim();
      text = text.slice(tabIdx + 1).trim();
    }

    if (!text) continue;

    result.push({
      time: parseTime(h, m, s, ms),
      text,
      ...(nick ? { nick } : {}),
    });
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

/** 按当前播放时间取出应当显示的弹幕（time <= current）。 */
export function collectActiveDanmaku(list: DanmakuItem[], current: number): DanmakuItem[] {
  return list.filter((d) => d.time <= current);
}
