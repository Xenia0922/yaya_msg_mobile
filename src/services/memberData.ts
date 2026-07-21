import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEMBERS_URL } from '../constants';
import { loadMembers } from '../utils/members';
import { Member } from '../types';
import { useMemberStore } from '../store';

const CACHE_KEY = 'yaya_member_data_cache_v1';

export interface MemberDataMeta {
  savedAt: number;
  signature: string;
  count: number;
  source: 'bundle' | 'remote' | 'cache';
}

/**
 * Build a lightweight change signature from the response headers so we can tell
 * whether the remote member database changed without re-parsing the whole payload.
 * Cloudflare Pages sends ETag for static assets; we fall back to Last-Modified /
 * Content-Length when ETag is absent.
 */
function signatureFromHeaders(res: Response): string {
  const etag = res.headers.get('ETag');
  if (etag) return `etag:${etag}`;
  const lm = res.headers.get('Last-Modified');
  if (lm) return `lm:${lm}`;
  const cl = res.headers.get('Content-Length');
  if (cl) return `cl:${cl}`;
  return '';
}

export async function loadCachedMemberData(): Promise<Member[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.members)) return null;
    return await loadMembers(parsed.members);
  } catch {
    return null;
  }
}

export async function getMemberDataMeta(): Promise<MemberDataMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      savedAt: parsed.savedAt || 0,
      signature: parsed.signature || '',
      count: parsed.count || 0,
      source: parsed.source || 'cache',
    };
  } catch {
    return null;
  }
}

export interface MemberUpdateResult {
  updated: boolean;
  count: number;
  message: string;
}

/**
 * Check whether the remote member database is newer than what we have cached, and
 * if so download, persist and reload it into the member store.
 *
 * `force: true` bypasses the signature check (used by the manual "检查更新" button
 * so the user can always re-pull even when the signature heuristic is inconclusive).
 */
export async function updateMemberData(opts: { force?: boolean } = {}): Promise<MemberUpdateResult> {
  const res = await fetch(`${MEMBERS_URL}?t=${Date.now()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const signature = signatureFromHeaders(res);
  const prev = await getMemberDataMeta();
  if (!opts.force && prev?.signature && signature && prev.signature === signature) {
    return { updated: false, count: prev.count, message: '成员数据已是最新' };
  }
  const json = await res.json();
  const members = await loadMembers(json);
  if (!members.length) throw new Error('返回的成员数据为空');
  await AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      members: json,
      signature,
      savedAt: Date.now(),
      count: members.length,
      source: 'remote',
    }),
  );
  useMemberStore.getState().setMembers(members);
  return {
    updated: true,
    count: members.length,
    message: prev ? `已更新为 ${members.length} 位成员` : `已载入 ${members.length} 位成员`,
  };
}
