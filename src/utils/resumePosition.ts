import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 续播位置持久化。
 *
 * 牙牙消息的回放走 WebView(<video>)，原生不记录进度。
 * 这里把「每个视频最后观看位置」落盘，下次打开时自动续播。
 * key 用视频 url（或外部传入的稳定 id），与下载/播放解耦。
 */

const STORAGE_KEY = 'yaya_resume_positions_v1';

type PositionMap = Record<string, number>;

async function readAll(): Promise<PositionMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PositionMap) : {};
  } catch {
    return {};
  }
}

async function writeAll(map: PositionMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 存储失败不应阻断播放
  }
}

/** 保存续播位置（秒）。值很小（<2 秒）或无效时不写，避免回放开头误跳。 */
// 节流：WebView 每 2s 上报一次进度，若每次都全量读写 AsyncStorage（readAll+writeAll）
// 会对存储造成不必要的 IO 压力。同一 id 在 30s 内且进度变化 <15s 时跳过写盘。
const lastWrite = new Map<string, { ts: number; value: number }>();
const WRITE_THROTTLE_MS = 30000;
const WRITE_THROTTLE_DELTA = 15;

/** 条目上限：按插入顺序淘汰最早的（值只有秒数、无时间戳，故依赖 Map/对象键序） */
const MAX_ENTRIES = 200;

/** 写入串行链：readAll → 改 → writeAll 是「读改写」，并发保存会互相覆盖丢位置 */
let writeChain: Promise<void> = Promise.resolve();

export function saveResumePosition(id: string, seconds: number, force = false): Promise<void> {
  if (!id || !Number.isFinite(seconds) || seconds < 2) return Promise.resolve();
  const now = Date.now();
  const prev = lastWrite.get(id);
  if (!force && prev && now - prev.ts < WRITE_THROTTLE_MS && Math.abs(seconds - prev.value) < WRITE_THROTTLE_DELTA) {
    return Promise.resolve();
  }
  lastWrite.set(id, { ts: now, value: seconds });
  writeChain = writeChain.then(async () => {
    const map = await readAll();
    map[id] = seconds;
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys.slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete map[k]);
    }
    await writeAll(map);
  });
  return writeChain;
}

/** 读取续播位置（秒），不存在返回 0。 */
export async function getResumePosition(id: string): Promise<number> {
  if (!id) return 0;
  const map = await readAll();
  const v = map[id];
  return Number.isFinite(v) ? v : 0;
}

/** 清空某个视频的续播位置（如播放完成）。同样走串行链，避免与保存互相覆盖。 */
export function clearResumePosition(id: string): Promise<void> {
  if (!id) return Promise.resolve();
  writeChain = writeChain.then(async () => {
    const map = await readAll();
    if (id in map) {
      delete map[id];
      await writeAll(map);
    }
  });
  return writeChain;
}
