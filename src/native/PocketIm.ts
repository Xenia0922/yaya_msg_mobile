import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

interface PocketImNative {
  appKey?: string;
  init(appKey: string): Promise<boolean>;
  status(): Promise<string>;
  login(accid: string, token: string): Promise<boolean>;
  logout(): void;
  sendChannelText(
    serverId: number,
    channelId: number,
    text: string,
    extJson: string,
  ): Promise<boolean>;
  observeMessages(enable: boolean): Promise<boolean>;

  joinChannel(serverId: number, channelId: number): Promise<boolean>;
}

const native: PocketImNative | undefined = (NativeModules as any)?.PocketIm;

export function isPocketImAvailable(): boolean {
  return Platform.OS === 'android' && !!native;
}

const FALLBACK_APP_KEY = '632feff1f4c838541ab75195d1ceb3fa';

export function pocketImAppKey(): string {
  return native?.appKey || FALLBACK_APP_KEY;
}

export async function pocketImInit(): Promise<void> {
  if (!native) throw new Error('当前平台不支持圈组消息通道');
  await native.init(pocketImAppKey());
}

export async function pocketImLogin(accid: string, token: string): Promise<void> {
  if (!native) throw new Error('当前平台不支持圈组消息通道');
  await native.login(accid, token);
}

export function pocketImLogout(): void {
  native?.logout?.();
}

export async function pocketImStatus(): Promise<string> {
  if (!native) return 'UNAVAILABLE';
  return native.status();
}

export async function pocketImSendChannelText(
  serverId: number,
  channelId: number,
  text: string,
  extJson: string,
): Promise<void> {
  if (!native) throw new Error('当前平台不支持圈组消息通道');
  await native.sendChannelText(serverId, channelId, text, extJson);
}

export async function pocketImObserveMessages(enable: boolean): Promise<void> {
  if (!native) return;
  await native.observeMessages(enable);
}

export async function pocketImJoinChannel(serverId: number, channelId: number): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.joinChannel(serverId, channelId);
  } catch {
    return false;
  }
}

export interface PocketImMessage {
  uuid: string;
  serverId: number;
  channelId: number;
  fromAccount: string;
  fromNick: string;
  time: number;
  content: string;

  msgType?: string;

  attachment?: string;

  extension: string;
}

export function addPocketImMessageListener(listener: (messages: PocketImMessage[]) => void): {
  remove: () => void;
} {
  if (!native) return { remove: () => undefined };
  const sub = DeviceEventEmitter.addListener('PocketIm:message', listener);
  return { remove: () => sub.remove() };
}

export function addPocketImStatusListener(listener: (status: string) => void): {
  remove: () => void;
} {
  if (!native) return { remove: () => undefined };
  const sub = DeviceEventEmitter.addListener('PocketIm:status', listener);
  return { remove: () => sub.remove() };
}
