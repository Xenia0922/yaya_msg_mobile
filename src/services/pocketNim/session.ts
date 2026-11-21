import { chatroomDisconnect, isPocketNimChatroomAvailable } from '../../native/PocketNimChatroom';
import { isPocketImAvailable, pocketImLogout } from '../../native/PocketIm';
import { logInfo } from '../../utils/runtimeLog';
import { clearNimCredentials } from './credentials';
import { resetQChatSession } from './qchat';

let sessionEpoch = 0;
const listeners = new Set<(epoch: number) => void>();

export function getNimSessionEpoch(): number {
  return sessionEpoch;
}

export function subscribeNimSession(listener: (epoch: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetNimSession(reason: string): void {
  sessionEpoch += 1;
  try {
    clearNimCredentials();
  } catch {}
  try {
    resetQChatSession(reason);
  } catch {}
  try {
    if (isPocketNimChatroomAvailable()) chatroomDisconnect();
  } catch {}
  try {
    if (isPocketImAvailable()) pocketImLogout();
  } catch {}
  logInfo(`[nim] 会话已重置（${reason}）→ epoch ${sessionEpoch}`, 'nim');
  listeners.forEach((fn) => {
    try {
      fn(sessionEpoch);
    } catch {}
  });
}
