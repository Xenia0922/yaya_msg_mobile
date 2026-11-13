import pocketApi from '../api/pocket48';
import { normalizeUrl, pickText } from '../utils/data';

const cache = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();
const failedUntil = new Map<string, number>();

export function normalizeLiveAvatar(value: unknown): string {
  const raw = String(value || '').trim();
  const url = /^avatar\//i.test(raw) ? normalizeUrl(`/${raw}`) : normalizeUrl(raw);
  return /^(https?:\/\/|data:image\/)/i.test(url) ? url : '';
}

export function getLiveUserAvatar(userId: string, onlyIfCapacity = false): Promise<string> {
  const cached = cache.get(userId);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.url);
  const existing = pending.get(userId);
  if (existing) return existing;
  if ((failedUntil.get(userId) || 0) > Date.now() || (onlyIfCapacity && pending.size >= 3)) return Promise.resolve('');
  const request = pocketApi.getUserProfile(userId).then((profile) => {
    const url = normalizeLiveAvatar(pickText(profile, ['content.baseUserInfo.avatar', 'content.baseUserInfo.userAvatar', 'content.userInfo.avatar', 'content.userInfo.userAvatar', 'content.user.avatar', 'content.user.userAvatar', 'content.avatar', 'content.userAvatar', 'data.baseUserInfo.avatar', 'data.baseUserInfo.userAvatar', 'data.userInfo.avatar', 'data.user.userAvatar', 'data.avatar', 'data.userAvatar']));
    if (url) {
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(userId, { url, expires: Date.now() + 5 * 60 * 1000 });
      failedUntil.delete(userId);
    } else {
      if (failedUntil.size >= 200) failedUntil.delete(failedUntil.keys().next().value!);
      failedUntil.set(userId, Date.now() + 30000);
    }
    return url;
  }).catch(() => {
    if (failedUntil.size >= 200) failedUntil.delete(failedUntil.keys().next().value!);
    failedUntil.set(userId, Date.now() + 30000);
    return '';
  }).finally(() => { pending.delete(userId); });
  pending.set(userId, request);
  return request;
}
