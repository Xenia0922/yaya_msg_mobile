import pocketApi from '../../api/pocket48';
import { ALLOW_CUSTOM_SENDER_PROFILE } from '../../constants/identityFeatures';
import { getSetting } from '../settings';
import { useSettingsStore } from '../../store';
import { logInfo } from '../../utils/runtimeLog';
import { credentialsToProfile, normalizeCredentials } from './runtime';
import { NimCredentials, NimSelfProfile } from './types';

let cached: NimCredentials | null = null;
let inflight: Promise<NimCredentials | null> | null = null;
let inflightToken = '';
let generation = 0;

let cachedToken = '';

let selfProfileCache: NimSelfProfile | null = null;
let selfProfileInflight: Promise<NimSelfProfile | null> | null = null;

function currentPocketToken(): string {
  try {
    return String(useSettingsStore.getState().settings.p48Token || '');
  } catch {
    return '';
  }
}

export function peekNimCredentials(): NimCredentials | null {
  return cachedToken === currentPocketToken() ? cached : null;
}

function invalidateChangedAccount(tokenNow: string): void {
  if ((cached && cachedToken !== tokenNow) || (inflight && inflightToken !== tokenNow)) {
    logInfo('[nim] 检测到口袋 token 变化，云信凭证缓存作废并重取', 'nim');
    clearNimCredentials();
  }
}

export async function loadNimCredentials(force = false): Promise<NimCredentials | null> {
  const tokenNow = currentPocketToken();
  invalidateChangedAccount(tokenNow);
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  const requestGeneration = generation;
  const requestRef: { current: Promise<NimCredentials | null> | null } = { current: null };
  const request = (async () => {
    try {
      const res = await pocketApi.getNimLoginInfo();
      if (requestGeneration !== generation || tokenNow !== currentPocketToken()) return null;
      const creds = normalizeCredentials(res);

      try {
        const content = (res && (res.content || res.data)) || {};
        // eslint-disable-next-line no-console
        console.log(
          '[nim] userinfo keys =',
          Object.keys(content).join(','),
          '| status =',
          (res && (res.status ?? res.code)) ?? '-',
        );
        // eslint-disable-next-line no-console
        console.log('[nim] creds valid =', Boolean(creds));
      } catch {}
      if (creds) {
        cached = creds;
        cachedToken = tokenNow;
      }
      return creds;
    } catch {
      return null;
    } finally {
      if (inflight === requestRef.current) {
        inflight = null;
        inflightToken = '';
      }
    }
  })();
  requestRef.current = request;
  inflight = request;
  inflightToken = tokenNow;
  return request;
}

function absFrame(a: string): string {
  const v = String(a || '').trim();
  if (!v) return '';
  if (/^(https?:)?\/\//i.test(v)) return v.startsWith('//') ? `https:${v}` : v;
  if (v.startsWith('avatar/') || v.startsWith('mediasource/') || v.startsWith('backstage'))
    return `https://source1.48.cn/${v}`;
  return `https://source.48.cn${v.startsWith('/') ? v : `/${v}`}`;
}

function absAvatar(a: string): string {
  const v = String(a || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://source.48.cn${v.startsWith('/') ? v : `/${v}`}`;
}

export async function loadSelfProfile(force = false): Promise<NimSelfProfile | null> {
  invalidateChangedAccount(currentPocketToken());
  const requestGeneration = generation;
  const requestToken = currentPocketToken();
  const resolvedProfile = await resolveSelfProfile(force);
  const profile = resolvedProfile ? { ...resolvedProfile } : null;
  if (!profile || requestGeneration !== generation || requestToken !== currentPocketToken())
    return null;

  if (!ALLOW_CUSTOM_SENDER_PROFILE) {
    return applySenderDecorations(profile, requestGeneration, requestToken);
  }

  try {
    const [nick, avatar, level, roleId, sessionRole, vip] = await Promise.all([
      getSetting('yaya_send_nickname'),
      getSetting('yaya_send_avatar'),
      getSetting('yaya_send_level'),
      getSetting('yaya_send_roleid'),
      getSetting('yaya_send_session_role'),
      getSetting('yaya_send_vip'),
    ]);
    if (requestGeneration !== generation || requestToken !== currentPocketToken()) return null;
    if (nick && nick.trim()) profile.nickName = nick.trim();
    if (avatar && avatar.trim()) profile.avatar = absAvatar(avatar.trim());
    if (level && level.trim() && Number.isFinite(Number(level))) profile.level = Number(level);
    if (roleId && roleId.trim() && Number.isFinite(Number(roleId))) profile.roleId = Number(roleId);
    if (sessionRole && sessionRole.trim() && Number.isFinite(Number(sessionRole))) {
      profile.sessionRole = Math.trunc(Number(sessionRole));
    }
    if (vip === 'on') profile.vip = true;
    else if (vip === 'off') profile.vip = false;
  } catch {}
  return applySenderDecorations(profile, requestGeneration, requestToken);
}

async function applySenderDecorations(
  profile: NimSelfProfile,
  requestGeneration: number,
  requestToken: string,
): Promise<NimSelfProfile | null> {
  try {
    const [pfUrl, badge] = await Promise.all([
      getSetting('yaya_send_pfurl'),
      getSetting('yaya_send_badge'),
    ]);
    if (requestGeneration !== generation || requestToken !== currentPocketToken()) return null;
    if (pfUrl && pfUrl.trim()) profile.pfUrl = absFrame(pfUrl.trim());
    if (badge && badge.trim()) {
      profile.badge = badge
        .split(',')
        .map((item: string) => absFrame(item.trim()))
        .filter(Boolean);
    }
  } catch {}
  return profile;
}

async function resolveSelfProfile(force: boolean): Promise<NimSelfProfile | null> {
  const requestGeneration = generation;
  const requestToken = currentPocketToken();
  const base = await loadNimCredentials(force).then((c) => (c ? credentialsToProfile(c) : null));
  if (requestGeneration !== generation || requestToken !== currentPocketToken()) return null;
  if (!force && selfProfileCache) return selfProfileCache;
  if (!selfProfileInflight) {
    const requestRef: { current: Promise<NimSelfProfile | null> | null } = { current: null };
    const request = (async () => {
      try {
        const res = await pocketApi.loginCheckToken();
        if (requestGeneration !== generation || requestToken !== currentPocketToken()) return null;
        const content = (res && (res.content || res.data)) || {};
        const u = (content.userInfo || content.user || content) as Record<string, any>;
        if (base && u && typeof u === 'object') {
          const baseInfo = (u.baseUserInfo || {}) as Record<string, unknown>;
          const nick = String(baseInfo.nickname || u.nickName || u.nickname || '').trim();
          if (nick) base.nickName = nick;
          const rawAvatar = baseInfo.avatar || u.avatar;
          if (rawAvatar) base.avatar = absAvatar(String(rawAvatar));

          base.level = Number(u.level) || 0;
          base.roleId = Number(u.roleId) || 0;
          base.vip = u.vip === true || u.vip === 1;
          base.pfUrl = String(u.pfUrl || '');
          base.teamLogo = String(u.teamLogo || '');
          const badge = Array.isArray(u.badge) && u.badge.length ? u.badge : u.seineBadge;
          if (Array.isArray(badge)) base.badge = badge;
        }
        selfProfileCache = base;
        return base;
      } catch {
        return requestGeneration === generation && requestToken === currentPocketToken()
          ? base
          : null;
      } finally {
        if (selfProfileInflight === requestRef.current) selfProfileInflight = null;
      }
    })();
    requestRef.current = request;
    selfProfileInflight = request;
  }
  return selfProfileInflight;
}

export function clearNimCredentials(): void {
  generation += 1;
  cached = null;
  cachedToken = '';
  selfProfileCache = null;
  selfProfileInflight = null;
  inflight = null;
  inflightToken = '';
}
