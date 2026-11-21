import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

interface PocketNimQChatNative {
  connect(appKey: string, account: string, token: string): Promise<boolean>;
  subscribe?(serverId: string): Promise<boolean>;
  subscribeBatch?(serverIds: string[]): Promise<boolean>;
  send(serverId: string, channelId: string, text: string, extJson: string): Promise<string>;
  sendCustom(
    serverId: string,
    channelId: string,
    attachment: string,
    extJson: string,
  ): Promise<string>;
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

  type: number;
  body: string;

  msgType?: string;
  attachment: string;

  ext: string;
  msgIdClient: string;
  msgIdServer: string;
}

export async function qchatConnect(appKey: string, account: string, token: string): Promise<void> {
  if (!native) throw new Error('当前平台不支持原生房间消息通道');
  await native.connect(appKey, account, token);
}

export async function qchatSubscribe(serverId: string): Promise<boolean> {
  if (!native?.subscribe) return false;
  try {
    return await native.subscribe(String(serverId));
  } catch {
    return false;
  }
}

export async function qchatSubscribeBatch(serverIds: string[]): Promise<boolean> {
  const unique = Array.from(new Set(serverIds.map((s) => String(s || '').trim()).filter(Boolean)));
  if (!unique.length) return false;
  if (native?.subscribeBatch) {
    try {
      return await native.subscribeBatch(unique);
    } catch {
      return false;
    }
  }
  if (!native?.subscribe) return false;
  const results = await Promise.allSettled(unique.map((id) => native.subscribe!(id)));
  return results.some((r) => r.status === 'fulfilled' && r.value);
}

export async function qchatSend(
  serverId: string,
  channelId: string,
  text: string,
  extJson: string,
): Promise<string> {
  if (!native) throw new Error('当前平台不支持原生房间消息通道');
  return native.send(serverId, channelId, text, extJson);
}

export function qchatDisconnect(): void {
  native?.disconnect?.();
}

export async function qchatSendCustom(
  serverId: string,
  channelId: string,
  attachment: string,
  extJson: string,
): Promise<string> {
  if (!native?.sendCustom) throw new Error('当前设备不支持发送表情包');
  return native.sendCustom(serverId, channelId, attachment, extJson);
}

export function onQChatStatus(
  listener: (status: { state: string; detail: string }) => void,
): () => void {
  const sub = DeviceEventEmitter.addListener('PocketNimQChat:status', (e: any) => {
    listener({ state: String(e?.state || 'idle'), detail: String(e?.detail || '') });
  });
  return () => sub.remove();
}

export function onQChatMessage(listener: (message: QChatNativeMessage) => void): () => void {
  const mapOne = (e: any): QChatNativeMessage => ({
    serverId: String(e?.serverId || ''),
    channelId: String(e?.channelId || ''),
    fromAccount: String(e?.fromAccount || ''),
    fromNick: String(e?.fromNick || ''),
    time: Number(e?.time) || Date.now(),
    type: Number(e?.type ?? 0),

    body: String(e?.body ?? e?.content ?? ''),
    msgType: String(e?.msgType || ''),
    attachment: String(e?.attachment || ''),

    ext: typeof e?.ext === 'string' ? e.ext : String(e?.extension || '{}'),

    msgIdClient: String(e?.msgIdClient || e?.uuid || ''),
    msgIdServer: String(e?.msgIdServer || ''),
  });
  const subOld = DeviceEventEmitter.addListener('PocketNimQChat:message', (e: any) => {
    listener(mapOne(e));
  });
  const subIm = DeviceEventEmitter.addListener('PocketIm:message', (arr: any) => {
    const list: any[] = Array.isArray(arr) ? arr : [arr];
    for (const e of list) listener(mapOne(e));
  });
  return () => {
    subOld.remove();
    subIm.remove();
  };
}
