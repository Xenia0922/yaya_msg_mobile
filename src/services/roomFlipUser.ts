import pocketApi from '../api/pocket48';
import { useSettingsStore } from '../store';

export type RoomFlipUser = { visibility: 'public' | 'anonymous' | 'private'; userId?: string; name?: string; avatar?: string };
let cacheToken = '';
const cache = new Map<string, Promise<RoomFlipUser | null>>();
const queue: Array<() => Promise<void>> = [];
let active = 0;

function pump() {
  while (active < 3 && queue.length) {
    const task = queue.shift()!;
    active += 1;
    void task().finally(() => { active -= 1; pump(); });
  }
}

export function getRoomFlipUser(token: string, questionId: string, answerId: string): Promise<RoomFlipUser | null> {
  if (cacheToken !== token) { cache.clear(); cacheToken = token; }
  const key = `${questionId}:${answerId}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const result = new Promise<RoomFlipUser | null>((resolve) => {
    queue.push(async () => {
      if (!token || useSettingsStore.getState().settings.p48Token !== token) { resolve(null); return; }
      try {
        const res = await pocketApi.getRoomFlipUser(questionId, answerId);
        if (useSettingsStore.getState().settings.p48Token !== token) { resolve(null); return; }
        const detail = res?.content || res?.data || {};
        if (Number(detail.type) === 3) resolve({ visibility: 'anonymous' });
        else if (Number(detail.type) !== 1) resolve({ visibility: 'private' });
        else resolve({ visibility: 'public', userId: typeof detail.userId === 'number' && !Number.isSafeInteger(detail.userId) ? '' : String(detail.userId || ''), name: String(detail.userName || ''), avatar: String(detail.userHeadimgurl || detail.headimgurl || '') });
      } catch { resolve(null); }
    });
    pump();
  });
  cache.set(key, result);
  void result.then((value) => { if (!value && cacheToken === token && cache.get(key) === result) cache.delete(key); });
  if (cache.size > 128) cache.delete(cache.keys().next().value!);
  return result;
}
