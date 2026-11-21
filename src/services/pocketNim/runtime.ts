import { NIM_APP_KEY, NIM_CHATROOM_ADDRESSES, NimCredentials, NimSelfProfile } from './types';

let sdkRef: any = null;

export function loadNimSdk(): any {
  if (sdkRef) return sdkRef;

  const mod = require('../../third_party/nim/NIM_Web_SDK_rn.js');
  sdkRef = mod && mod.default ? mod.default : mod;
  return sdkRef;
}

export function normalizeCredentials(raw: any): NimCredentials | null {
  if (!raw || typeof raw !== 'object') return null;
  const content = raw.content || raw.data || raw;
  if (!content || typeof content !== 'object') return null;

  const userInfo = content.userInfo || content.user || {};
  const accid = String(
    content.accid || content.accId || content.imUserId || userInfo.accid || userInfo.imUserId || '',
  );
  const token = String(content.pwd || content.token || content.imPwd || userInfo.imPwd || '');
  if (!accid || !token) return null;

  const rawUserId = content.userId ?? userInfo.userId ?? 0;
  const rawUserIdText = String(rawUserId).trim();
  const numericUserId = Number(rawUserIdText);
  const userId: number | string =
    rawUserIdText && Number.isSafeInteger(numericUserId) ? numericUserId : rawUserIdText || 0;
  return {
    accid,
    token,
    userId,
    nickName: String(userInfo.nickName || userInfo.nickname || content.nickName || ''),
    avatar: String(userInfo.avatar || content.avatar || ''),
    level: Number(userInfo.level || 0) || 0,
    roleId: Number(userInfo.roleId || 0) || 0,
  };
}

export function credentialsToProfile(creds: NimCredentials): NimSelfProfile {
  return {
    userId: creds.userId,
    nickName: creds.nickName,
    avatar: creds.avatar,
    level: creds.level,
    roleId: creds.roleId,
    accid: creds.accid,
  };
}

export { NIM_APP_KEY, NIM_CHATROOM_ADDRESSES };
export type { NimCredentials, NimSelfProfile };
