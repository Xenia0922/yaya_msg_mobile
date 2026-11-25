import pocketApi from '../api/pocket48';
import { unwrapList } from '../utils/data';
import { readFollowedIdsCache, writeFollowedIdsCache } from './followedIds';

const DEFAULT_FOLLOWED_TTL_MS = 15_000;
const DEFAULT_LIVE_TTL_MS = 10_000;

let sharedGeneration = 0;

let memToken = '';
let memFollowedIds = new Set<string>();
let memFollowedLoadedAt = 0;
let memFollowedNetworkFresh = false;
const followedInflight = new Map<string, Promise<string[]>>();
const followedListeners = new Set<(ids: Set<string>, token: string) => void>();

let liveCacheData: any = null;
let liveCacheAt = 0;
let liveInflight: Promise<any> | null = null;

function normToken(token?: string | null): string {
  return String(token || '').trim();
}

function ensureFollowedToken(token: string): void {
  if (token === memToken) return;
  memToken = token;
  memFollowedIds = new Set();
  memFollowedLoadedAt = 0;
  memFollowedNetworkFresh = false;
}

function emitFollowedIds(ids: Set<string>, token: string): void {
  const copy = new Set(ids);
  followedListeners.forEach((listener) => {
    try {
      listener(copy, token);
    } catch {}
  });
}

export function subscribeFollowedIds(
  listener: (ids: Set<string>, token: string) => void,
): () => void {
  followedListeners.add(listener);
  return () => {
    followedListeners.delete(listener);
  };
}

export function peekFollowedIdsShared(token?: string | null): Set<string> {
  const tk = normToken(token);
  if (!tk || tk !== memToken) return new Set();
  return new Set(memFollowedIds);
}

export async function hydrateFollowedIdsShared(
  token?: string | null,
): Promise<{ ids: string[]; cached: boolean }> {
  const tk = normToken(token);
  if (!tk) return { ids: [], cached: false };
  ensureFollowedToken(tk);
  if (memFollowedLoadedAt > 0 || memFollowedIds.size > 0) {
    return { ids: Array.from(memFollowedIds), cached: true };
  }
  const gen = sharedGeneration;
  const cached = await readFollowedIdsCache(tk);
  if (gen !== sharedGeneration || tk !== memToken) {
    return { ids: [], cached: false };
  }
  if (cached.cached && !memFollowedNetworkFresh && memFollowedLoadedAt === 0) {
    memFollowedIds = new Set(cached.ids);
    emitFollowedIds(memFollowedIds, tk);
  }
  return cached;
}

export async function fetchFollowedIdsShared(
  token?: string | null,
  opts?: { force?: boolean; ttlMs?: number },
): Promise<string[]> {
  const tk = normToken(token);
  if (!tk) return [];
  ensureFollowedToken(tk);
  const ttlMs = opts?.ttlMs ?? DEFAULT_FOLLOWED_TTL_MS;
  if (
    !opts?.force &&
    memFollowedNetworkFresh &&
    memFollowedLoadedAt > 0 &&
    Date.now() - memFollowedLoadedAt < ttlMs
  ) {
    return Array.from(memFollowedIds);
  }

  const inflight = followedInflight.get(tk);
  if (inflight) return inflight;

  const gen = sharedGeneration;
  const task = pocketApi
    .getFollowedIds()
    .then((res: any) => {
      const ids = unwrapList(res, ['content.data', 'content', 'data', 'list']).map(String);
      if (gen === sharedGeneration && tk === memToken) {
        memFollowedIds = new Set(ids);
        memFollowedLoadedAt = Date.now();
        memFollowedNetworkFresh = true;
        emitFollowedIds(memFollowedIds, tk);
      }
      void writeFollowedIdsCache(tk, ids);
      return ids;
    })
    .finally(() => {
      if (followedInflight.get(tk) === task) {
        followedInflight.delete(tk);
      }
    });

  followedInflight.set(tk, task);
  return task;
}

export function mutateFollowedIdShared(
  token: string | null | undefined,
  memberId: string,
  following: boolean,
): string[] {
  const tk = normToken(token);
  const id = String(memberId || '').trim();
  if (!tk || !id) return [];
  ensureFollowedToken(tk);
  const next = new Set(memFollowedIds);
  if (following) next.add(id);
  else next.delete(id);
  memFollowedIds = next;
  memFollowedLoadedAt = Date.now();
  const list = Array.from(next);
  void writeFollowedIdsCache(tk, list);
  emitFollowedIds(next, tk);
  return list;
}

export async function fetchLiveListShared(opts?: {
  force?: boolean;
  ttlMs?: number;
  debug?: boolean;
}): Promise<any> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_LIVE_TTL_MS;
  if (!opts?.force && liveCacheData && Date.now() - liveCacheAt < ttlMs) {
    return liveCacheData;
  }
  if (liveInflight) return liveInflight;

  const gen = sharedGeneration;
  const task = pocketApi
    .getLiveList({
      groupId: 0,
      liveType: 0,
      next: 0,
      record: false,
      debug: opts?.debug ?? false,
      size: 100,
    })
    .then((res: any) => {
      const shellList = (res?.content ?? res?.data ?? res)?.liveList;
      if (gen === sharedGeneration && Array.isArray(shellList)) {
        liveCacheData = res;
        liveCacheAt = Date.now();
      }
      return res;
    })
    .finally(() => {
      if (liveInflight === task) {
        liveInflight = null;
      }
    });

  liveInflight = task;
  return task;
}

export function resetSharedPocketData(): void {
  sharedGeneration += 1;
  memToken = '';
  memFollowedIds = new Set();
  memFollowedLoadedAt = 0;
  memFollowedNetworkFresh = false;
  followedInflight.clear();
  liveCacheData = null;
  liveCacheAt = 0;
  liveInflight = null;
  emitFollowedIds(new Set(), '');
}
