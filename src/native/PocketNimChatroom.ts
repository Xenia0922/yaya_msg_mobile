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

export type ChatroomNativeState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface ChatroomNativeStatus {
  state: ChatroomNativeState;
  detail: string;
}

export interface ChatroomNativeMessage {
  uuid: string;

  msgType: number;
  text: string;
  fromNick: string;
  fromAvatar: string;
  fromAccount: string;
  time: number;

  ext: string;
}

export async function chatroomConnect(
  appKey: string,
  account: string,
  token: string,
  roomId: string,
): Promise<void> {
  if (!native) throw new Error('当前平台不支持原生聊天室通道');
  await native.connect(appKey, account, token, roomId);
}

export async function chatroomSend(text: string, customJson: string): Promise<string> {
  if (!native) throw new Error('当前平台不支持原生聊天室通道');
  return native.send(text, customJson);
}

export function chatroomDisconnect(): void {
  native?.disconnect?.();
}

export async function chatroomStatus(): Promise<{
  state: string;
  detail: string;
  connected: boolean;
}> {
  if (!native) return { state: 'unavailable', detail: '', connected: false };
  return native.status();
}

export function onChatroomStatus(listener: (status: ChatroomNativeStatus) => void): () => void {
  const sub = DeviceEventEmitter.addListener('PocketNimChatroom:status', (e: any) => {
    listener({
      state: String(e?.state || 'idle') as ChatroomNativeState,
      detail: String(e?.detail || ''),
    });
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
  listener: (result: { idClient: string; ok: boolean; detail: string }) => void,
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
    if (e?.count == null) return;
    const count = Number(e.count);
    if (Number.isInteger(count) && count >= 0) listener(count);
  });
  return () => sub.remove();
}
