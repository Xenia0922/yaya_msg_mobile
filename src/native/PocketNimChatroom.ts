/**
 * 云信聊天室（直播弹幕）原生桥 —— commonlink 协议版。
 *
 * 原生实现：android/app/src/main/java/com/yk1z/yayamsg/nim/
 *   NimProtocol.kt（包编解码 + RC4 + RSA 握手）
 *   NimChatroomClient.kt（LBS → TCP → 进房 → 心跳 → 收/发弹幕）
 *   PocketNimChatroomModule.kt（RN 模块）
 *
 * 与 JS 侧云信 Web SDK 的区别：**登录包里的客户端包名由自己填**，
 * 因此能过口袋48 appKey 的服务端标识校验（Web SDK 带浏览器标识 → 403）。
 */

import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

interface PocketNimChatroomNative {
  connect(appKey: string, account: string, token: string, roomId: string): Promise<boolean>;
  send(text: string, customJson: string): Promise<string>;
  disconnect(): void;
  status(): Promise<{ state: string; detail: string; connected: boolean }>;
}

const native: PocketNimChatroomNative | undefined = (NativeModules as any)?.PocketNimChatroom;

export function isPocketNimChatroomAvailable(): boolean {
  return Platform.OS === 'android' && !!native;
}

export type ChatroomNativeState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface ChatroomNativeStatus {
  state: ChatroomNativeState;
  detail: string;
}

export interface ChatroomNativeMessage {
  uuid: string;
  /** 0 = 文本，100 = 自定义（弹幕/礼物/进场等看 ext） */
  msgType: number;
  text: string;
  fromNick: string;
  fromAvatar: string;
  fromAccount: string;
  time: number;
  /** remoteExtension 的 JSON 字符串 */
  ext: string;
}

export async function chatroomConnect(
  appKey: string,
  account: string,
  token: string,
  roomId: string
): Promise<void> {
  if (!native) throw new Error('当前平台不支持原生聊天室通道');
  await native.connect(appKey, account, token, roomId);
}

/** 返回 idClient；服务端回执经 onChatroomSendResult 事件回来（成功才 resolve 的话用 sendAndWait） */
export async function chatroomSend(text: string, customJson: string): Promise<string> {
  if (!native) throw new Error('当前平台不支持原生聊天室通道');
  return native.send(text, customJson);
}

export function chatroomDisconnect(): void {
  native?.disconnect?.();
}

export async function chatroomStatus(): Promise<{ state: string; detail: string; connected: boolean }> {
  if (!native) return { state: 'unavailable', detail: '', connected: false };
  return native.status();
}

export function onChatroomStatus(listener: (status: ChatroomNativeStatus) => void): () => void {
  const sub = DeviceEventEmitter.addListener('PocketNimChatroom:status', (e: any) => {
    listener({ state: String(e?.state || 'idle') as ChatroomNativeState, detail: String(e?.detail || '') });
  });
  return () => sub.remove();
}

export function onChatroomMessage(listener: (message: ChatroomNativeMessage) => void): () => void {
  const sub = DeviceEventEmitter.addListener('PocketNimChatroom:message', (e: any) => {
    listener({
      uuid: String(e?.uuid || ''),
      msgType: Number(e?.msgType ?? -1),
      text: String(e?.text || ''),
      fromNick: String(e?.fromNick || ''),
      fromAvatar: String(e?.fromAvatar || ''),
      fromAccount: String(e?.fromAccount || ''),
      time: Number(e?.time) || Date.now(),
      ext: String(e?.ext || '{}'),
    });
  });
  return () => sub.remove();
}

export function onChatroomSendResult(
  listener: (result: { idClient: string; ok: boolean; detail: string }) => void
): () => void {
  const sub = DeviceEventEmitter.addListener('PocketNimChatroom:sendResult', (e: any) => {
    listener({
      idClient: String(e?.idClient || ''),
      ok: !!e?.ok,
      detail: String(e?.detail || ''),
    });
  });
  return () => sub.remove();
}

export function onChatroomOnline(listener: (count: number) => void): () => void {
  const sub = DeviceEventEmitter.addListener('PocketNimChatroom:online', (e: any) => {
    listener(Number(e?.count) || 0);
  });
  return () => sub.remove();
}
