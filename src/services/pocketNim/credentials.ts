/**
 * 云信登录凭证获取（口袋48 HTTP：im/api/v1/im/userinfo）。
 *
 * 返回 content.accid + content.pwd（旧字段 accId / imUserId / token / imPwd 兜底）。
 * 同一 App 生命周期内只取一次，失败不缓存（下次调用重试）。
 */

import pocketApi from '../../api/pocket48';
import { normalizeCredentials } from './runtime';
import { NimCredentials } from './types';

let cached: NimCredentials | null = null;
let inflight: Promise<NimCredentials | null> | null = null;

export function peekNimCredentials(): NimCredentials | null {
  return cached;
}

export async function loadNimCredentials(force = false): Promise<NimCredentials | null> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await pocketApi.getNimLoginInfo();
      const creds = normalizeCredentials(res);
      if (creds) cached = creds;
      return creds;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearNimCredentials(): void {
  cached = null;
}
