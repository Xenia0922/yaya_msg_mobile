/**
 * 成员房间消息（云信 QChat / 圈组）原生桥 —— commonlink 协议版。
 *
 * 原生实现：android/app/src/main/java/com/yk1z/yayamsg/nim/
 *   NimCommonlinkSession.kt（TCP + RSA 握手 + RC4 + 请求应答）
 *   NimQChatClient.kt（NIM 会话 → 24/1 取 QChat 地址 → QChat 会话 → 收 24/11 / 发 24/10）
 *
 * 关键：登录鉴权属性里包名自己填（白名单包 `com.seine48.app`），
 * 官方 SDK 只能带真实包名 → 服务端拒（实测 414）。
 */

import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

interface PocketNimQChatNative {
  connect(appKey: string, account: string, token: string): Promise<boolean>;
  send(serverId: string, channelId: string, text: string, extJson: string): Promise<string>;
  disconnect(): void;
}

const native: PocketNimQChatNative | undefined = (NativeModules as any)?.PocketNimQChat;

export function isPocketNimQChatAvailable(): boolean {
  return Platform.OS === 'android' && !!native;
}

export interface QChatNativeMessage {
  serverId: string;
  channelId: string;
  fromAccount: string;
  fromNick: string;
  time: number;
  /** 0 = 文本，100 = 自定义 */
  type: number;
  body: string;
  attachment: string;
  /** remoteExtension 的 JSON 字符串 */
  ext: string;
  msgIdClient: string;
  msgIdServer: string;
}

export async function qchatConnect(appKey: string, account: string, token: string): Promise<void> {
  if (!native) throw new Error('当前平台不支持原生房间消息通道');
  await native.connect(appKey, account, token);
}

/** 返回 msgIdClient（发送成功由服务端应答确认，这里 await 到应答后返回） */
export async function qchatSend(
  serverId: string,
  channelId: string,
  text: string,
  extJson: string
): Promise<string> {
  if (!native) throw new Error('当前平台不支持原生房间消息通道');
  return native.send(serverId, channelId, text, extJson);
}

export function qchatDisconnect(): void {
  native?.disconnect?.();
}

export function onQChatStatus(listener: (status: { state: string; detail: string }) => void): () => void {
  const sub = DeviceEventEmitter.addListener('PocketNimQChat:status', (e: any) => {
    listener({ state: String(e?.state || 'idle'), detail: String(e?.detail || '') });
  });
  return () => sub.remove();
}

export function onQChatMessage(listener: (message: QChatNativeMessage) => void): () => void {
  const sub = DeviceEventEmitter.addListener('PocketNimQChat:message', (e: any) => {
    listener({
      serverId: String(e?.serverId || ''),
      channelId: String(e?.channelId || ''),
      fromAccount: String(e?.fromAccount || ''),
      fromNick: String(e?.fromNick || ''),
      time: Number(e?.time) || Date.now(),
      type: Number(e?.type ?? 0),
      body: String(e?.body || ''),
      attachment: String(e?.attachment || ''),
      ext: String(e?.ext || '{}'),
      msgIdClient: String(e?.msgIdClient || ''),
      msgIdServer: String(e?.msgIdServer || ''),
    });
  });
  return () => sub.remove();
}
