import { useEffect, useState } from 'react';
import pocketApi from '../api/pocket48';
import { getLiveUserAvatar, normalizeLiveAvatar } from '../services/liveAvatarCache';

export interface PocketAccountSummary {
  name: string;
  avatar: string;
}

const accountCache = new Map<string, PocketAccountSummary>();
const inflightMap = new Map<string, Promise<PocketAccountSummary | null>>();

async function fetchAccountSummary(token: string): Promise<PocketAccountSummary | null> {
  const existing = inflightMap.get(token);
  if (existing) return existing;

  const task = pocketApi
    .loginCheckToken()
    .then(async (res: any) => {
      const c: any = res?.content || res?.data || res || {};
      const u: any = c.userInfo || c.user || c.baseUserInfo || c.userList?.[0] || c;
      const base: any = u?.baseUserInfo || {};
      const userId = String(base.userId || u.userId || u.id || c.userId || '').trim();
      const name = String(
        base.nickname ||
          u.nickname ||
          u.nickName ||
          u.name ||
          u.userName ||
          c.nickname ||
          c.nickName ||
          '',
      ).trim();
      let avatar = normalizeLiveAvatar(
        base.avatar ||
          base.faceImage ||
          u.avatar ||
          u.userAvatar ||
          u.headImg ||
          u.avatarUrl ||
          c.avatar ||
          c.userAvatar ||
          '',
      );
      if (!avatar && userId) avatar = await getLiveUserAvatar(userId).catch(() => '');
      if (!name && !avatar) return null;
      const summary = { name, avatar };
      accountCache.set(token, summary);
      return summary;
    })
    .catch(() => null)
    .finally(() => {
      inflightMap.delete(token);
    });

  inflightMap.set(token, task);
  return task;
}

export function usePocketAccountSummary(token?: string): PocketAccountSummary | null {
  const trimmed = String(token || '').trim();
  const [account, setAccount] = useState<PocketAccountSummary | null>(() =>
    trimmed ? (accountCache.get(trimmed) ?? null) : null,
  );

  useEffect(() => {
    if (!trimmed) {
      setAccount(null);
      return;
    }
    const cached = accountCache.get(trimmed);
    if (cached) {
      setAccount(cached);
      return;
    }
    let alive = true;
    fetchAccountSummary(trimmed).then((summary) => {
      if (alive && summary) setAccount(summary);
    });
    return () => {
      alive = false;
    };
  }, [trimmed]);

  return account;
}
