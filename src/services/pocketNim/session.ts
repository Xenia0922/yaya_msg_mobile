/**
 * 云信会话世代（session epoch）与全局重置。
 *
 * 为什么需要：登录 / 切换大小号 / 换号后，云信侧（聊天室弹幕 + 圈组房间消息）持有一整套
 * 「账号态」——凭证缓存、自身资料缓存、IM/QChat 登录标志、原生 TCP 连接。这些都不会随
 * HTTP token 变化自动失效，于是出现用户反馈的：
 *   - 切号后短时间内发的房间消息 / 弹幕带**旧号身份**（或落到旧号所在的房间）；
 *   - 新号与旧 accid 不匹配 → **有概率连不上房间**（连接鉴权被拒 / 发送被踢）。
 *
 * 统一入口：切号与登出后调用 resetNimSession()，它会
 *   1) 清掉 NIM 凭证与自身资料缓存（含 inflight）；
 *   2) 复位原生通道登录态并断开连接（下次发送/进房按新账号重连）；
 *   3) 递增 epoch 并广播 —— 所有持连接的地方（直播弹幕、房间消息订阅）据此重订阅/重连。
 */

import { chatroomDisconnect, isPocketNimChatroomAvailable } from '../../native/PocketNimChatroom';
import { logInfo } from '../../utils/runtimeLog';
import { clearNimCredentials } from './credentials';
import { resetQChatSession } from './qchat';

let sessionEpoch = 0;
const listeners = new Set<(epoch: number) => void>();

/** 当前会话世代；变化即代表「换过账号 / 重置过云信会话」 */
export function getNimSessionEpoch(): number {
  return sessionEpoch;
}

/** 订阅会话重置（返回取消订阅函数） */
export function subscribeNimSession(listener: (epoch: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 重置云信会话（切号 / 换号 / 登出后必须调用）。
 * 不抛错：任何一步失败都不影响主流程（下次使用会重新拉凭证）。
 */
export function resetNimSession(reason: string): void {
  sessionEpoch += 1;
  try {
    clearNimCredentials();
  } catch {
    /* 忽略 */
  }
  try {
    resetQChatSession(reason);
  } catch {
    /* 忽略 */
  }
  try {
    if (isPocketNimChatroomAvailable()) chatroomDisconnect();
  } catch {
    /* 忽略 */
  }
  logInfo(`[nim] 会话已重置（${reason}）→ epoch ${sessionEpoch}`, 'nim');
  listeners.forEach((fn) => {
    try {
      fn(sessionEpoch);
    } catch {
      /* 单个订阅者异常不影响其它订阅者 */
    }
  });
}
