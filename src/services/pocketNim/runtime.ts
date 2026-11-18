/**
 * 云信运行时：SDK 懒加载、凭证归一化、单例管理。
 *
 * 内置的是官方 React Native 版本（NIM_Web_SDK_rn.js，@yxim/nim-web-sdk 9.21.14），
 * 导出 { NIM, Chatroom, ... }，可直接在 RN 里 require（已确认只有 react-native 与
 * push-notification-ios 两个外部依赖，后者用空实现替换，理由见代码注释）。
 */

import { NIM_APP_KEY, NIM_CHATROOM_ADDRESSES, NimCredentials, NimSelfProfile } from './types';

let sdkRef: any = null;

/** 懒加载内置 SDK（避免 App 启动即解析 1MB 包体） */
export function loadNimSdk(): any {
  if (sdkRef) return sdkRef;

  const mod = require('../../third_party/nim/NIM_Web_SDK_rn.js');
  sdkRef = mod && mod.default ? mod.default : mod;
  return sdkRef;
}

/** 口袋48 HTTP 侧下发的云信凭证（im/api/v1/im/userinfo）→ 统一结构 */
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

  // 64 位 userId 可能是 19 位字符串：直接 Number 会超过 2^53 丢精度（发出去的身份 id 就错了）。
  // 安全整数范围内保持 number（兼容既有逻辑），超出则原样保留字符串。
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
