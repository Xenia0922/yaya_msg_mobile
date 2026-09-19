/**
 * 云信登录凭证获取（口袋48 HTTP：im/api/v1/im/userinfo）。
 *
 * 返回 content.accid + content.pwd（旧字段 accId / imUserId / token / imPwd 兜底）。
 * 同一 App 生命周期内只取一次，失败不缓存（下次调用重试）。
 */

import pocketApi from '../../api/pocket48';
import { getSetting } from '../settings';
import { useSettingsStore } from '../../store';
import { logInfo } from '../../utils/runtimeLog';
import { credentialsToProfile, normalizeCredentials } from './runtime';
import { NimCredentials, NimSelfProfile } from './types';

let cached: NimCredentials | null = null;
let inflight: Promise<NimCredentials | null> | null = null;
/**
 * 缓存凭证对应的口袋 token。
 * 切号（switchBigSmall）/ 重新登录后 token 变了，但缓存里的 accid/token 还是旧号的
 * —— 若不清掉，接下来所有云信操作（弹幕 / 房间消息）都会用**旧身份**发出，
 * 且新旧 accid 不匹配还可能连不上房间（用户反馈的核心问题）。
 * 这里做一层自愈：token 变化即视为凭证过期。
 */
let cachedToken = '';

/** 自身资料（发送身份）缓存：与凭证同源，换号必须一起作废 */
let selfProfileCache: NimSelfProfile | null = null;
let selfProfileInflight: Promise<NimSelfProfile | null> | null = null;

/** 当前口袋 token（切号的唯一权威源与其一致） */
function currentPocketToken(): string {
  try {
    return String(useSettingsStore.getState().settings.p48Token || '');
  } catch {
    return '';
  }
}

export function peekNimCredentials(): NimCredentials | null {
  return cached;
}

export async function loadNimCredentials(force = false): Promise<NimCredentials | null> {
  const tokenNow = currentPocketToken();
  // token 变了（切号/换号/重新登录）→ 缓存凭证与自身资料一律作废，重取
  if (cached && tokenNow && cachedToken !== tokenNow) {
    logInfo('[nim] 检测到口袋 token 变化，云信凭证缓存作废并重取', 'nim');
    cached = null;
    selfProfileCache = null;
  }
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
      if (creds) {
        cached = creds;
        cachedToken = currentPocketToken();
      }
      return creds;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 相对路径头像 → source.48.cn 绝对地址（App 内同款惯例） */function absAvatar(a: string): string {
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
  const profile = await resolveSelfProfile(force);
  if (!profile) return null;
  return profile;
}

async function resolveSelfProfile(force: boolean): Promise<NimSelfProfile | null> {
  const base = await loadNimCredentials(force).then((c) => (c ? credentialsToProfile(c) : null));
  if (base && base.nickName && base.avatar) return base;
  if (!force && selfProfileCache) return selfProfileCache;
  if (!selfProfileInflight) {
    selfProfileInflight = (async () => {
      try {
        const res = await pocketApi.loginCheckToken();
        const content = (res && (res.content || res.data)) || {};
        const u = (content.userInfo || content.user || content) as Record<string, any>;
        if (base && u && typeof u === 'object') {
          const nick = String(u.nickName || u.nickname || '').trim();
          if (nick) base.nickName = nick;
          if (u.avatar) base.avatar = absAvatar(String(u.avatar));
          // level/roleId 以 user/info/reload 为准（覆盖 getNimLoginInfo 的值）：
          // 真机实测 roleId 被污染后，普通粉丝发房间消息会被当成员处理（出红点提示）
          base.level = Number(u.level) || 0;
          base.roleId = Number(u.roleId) || 0;
          base.vip = u.vip === true || u.vip === 1;
          base.pfUrl = String(u.pfUrl || '');
          base.teamLogo = String(u.teamLogo || '');
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

/**
 * 清空云信会话缓存（切号/登出）。
 * ⚠️ 必须连自身资料缓存一起清：只清 cached 的话，新号资料字段缺失时
 *    resolveSelfProfile 会回落到旧号的 selfProfileCache → 用旧号的昵称/头像/等级发言。
 */
export function clearNimCredentials(): void {
  cached = null;
  cachedToken = '';
  selfProfileCache = null;
  selfProfileInflight = null;
  inflight = null;
}
