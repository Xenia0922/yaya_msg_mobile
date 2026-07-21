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
export async function saveResumePosition(id: string, seconds: number): Promise<void> {
  if (!id || !Number.isFinite(seconds) || seconds < 2) return;
  const map = await readAll();
  map[id] = seconds;
  await writeAll(map);
}

/** 读取续播位置（秒），不存在返回 0。 */
export async function getResumePosition(id: string): Promise<number> {
  if (!id) return 0;
  const map = await readAll();
  const v = map[id];
  return Number.isFinite(v) ? v : 0;
}

/** 清空某个视频的续播位置（如播放完成）。 */
export async function clearResumePosition(id: string): Promise<void> {
  if (!id) return;
  const map = await readAll();
  if (id in map) {
    delete map[id];
    await writeAll(map);
  }
}
