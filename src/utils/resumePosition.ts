import AsyncStorage from '@react-native-async-storage/async-storage';

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
  } catch {}
}

const lastWrite = new Map<string, { ts: number; value: number }>();
const WRITE_THROTTLE_MS = 30000;
const WRITE_THROTTLE_DELTA = 15;

const MAX_ENTRIES = 200;

let writeChain: Promise<void> = Promise.resolve();

export function saveResumePosition(id: string, seconds: number, force = false): Promise<void> {
  if (!id || !Number.isFinite(seconds) || seconds < 2) return Promise.resolve();
  const now = Date.now();
  const prev = lastWrite.get(id);
  if (
    !force &&
    prev &&
    now - prev.ts < WRITE_THROTTLE_MS &&
    Math.abs(seconds - prev.value) < WRITE_THROTTLE_DELTA
  ) {
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

export async function getResumePosition(id: string): Promise<number> {
  if (!id) return 0;
  const map = await readAll();
  const v = map[id];
  return Number.isFinite(v) ? v : 0;
}

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
