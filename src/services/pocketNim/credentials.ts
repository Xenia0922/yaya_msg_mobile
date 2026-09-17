/**
 * 云信登录凭证获取（口袋48 HTTP：im/api/v1/im/userinfo）。
 *
 * 返回 content.accid + content.pwd（旧字段 accId / imUserId / token / imPwd 兜底）。
 * 同一 App 生命周期内只取一次，失败不缓存（下次调用重试）。
 */

import pocketApi from '../../api/pocket48';
import { credentialsToProfile, normalizeCredentials } from './runtime';
import { NimCredentials, NimSelfProfile } from './types';

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
      // 诊断（排查云信登录 414）：打印原始响应键路径与归一化结果（token 只留长度/前 4 位）
      try {
        const content = (res && (res.content || res.data)) || {};
        // eslint-disable-next-line no-console
        console.log('[nim] userinfo keys =', Object.keys(content).join(','), '| status =', (res && (res.status ?? res.code)) ?? '-');
        // eslint-disable-next-line no-console
        console.log('[nim] creds =', creds ? `accid=${creds.accid} userId=${creds.userId} tokenLen=${creds.token.length} tokenHead=${creds.token.slice(0, 4)}` : 'null');
      } catch {
        /* 诊断失败忽略 */
      }
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

let selfProfileCache: NimSelfProfile | null = null;
let selfProfileInflight: Promise<NimSelfProfile | null> | null = null;

/** 相对路径头像 → source.48.cn 绝对地址（App 内同款惯例） */
function absAvatar(a: string): string {
  const v = String(a || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://source.48.cn${v.startsWith('/') ? v : `/${v}`}`;
}

/**
 * 发送身份（弹幕/房间消息 remoteExtension.user）。
 *
 * getNimLoginInfo 只保证 accid/token/userId —— 昵称/头像/等级经常缺失，
 * 直接发出去别人看到的就是「无名字无头像」（真机实测实锤）。
 * 这里补一手 user/info/reload（登录态校验同款接口，返回完整用户资料），结果缓存。
 */
export async function loadSelfProfile(force = false): Promise<NimSelfProfile | null> {
  const base = await loadNimCredentials(force).then((c) => (c ? credentialsToProfile(c) : null));
  if (base && base.nickName && base.avatar) return base;
  if (!force && selfProfileCache) return selfProfileCache;
  if (!selfProfileInflight) {
    selfProfileInflight = (async () => {
      try {
        const res = await pocketApi.loginCheckToken();
        const content = (res && (res.content || res.data)) || {};
        const u = (content.userInfo || content.user || content) as Record<string, any>;
        if (base) {
          const nick = String(u.nickName || u.nickname || '').trim();
          if (nick) base.nickName = nick;
          if (u.avatar) base.avatar = absAvatar(String(u.avatar));
          if (u.level != null) base.level = Number(u.level) || 0;
          if (u.roleId != null) base.roleId = Number(u.roleId) || 0;
          if (u.vip != null) base.vip = u.vip === true || u.vip === 1;
          if (u.pfUrl != null) base.pfUrl = String(u.pfUrl || '');
          if (u.teamLogo != null) base.teamLogo = String(u.teamLogo || '');
        }
        selfProfileCache = base;
        return base;
      } catch {
        return base;
      } finally {
        selfProfileInflight = null;
      }
    })();
  }
  return selfProfileInflight;
}

export function clearNimCredentials(): void {
  cached = null;
}
