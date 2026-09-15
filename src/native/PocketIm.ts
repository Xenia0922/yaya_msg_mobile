/**
 * 口袋48 云信消息原生桥（Android）。
 *
 * 原生实现见 android/app/src/main/java/com/yk1z/yayamsg/PocketImModule.java：
 * 只有「房间消息 = 云信圈组（QChat）」这一条链路必须走原生（官方 Web/RN SDK 不含圈组收发）。
 * iOS/其他平台没有该模块，调用方需用 isPocketImAvailable() 判断。
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

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
    extJson: string
  ): Promise<boolean>;
  observeMessages(enable: boolean): Promise<boolean>;
}

const native: PocketImNative | undefined = (NativeModules as any)?.PocketIm;

export function isPocketImAvailable(): boolean {
  return Platform.OS === 'android' && !!native;
}

/** 与官方一致的云信 appKey（原生侧常量，取不到时用同值兜底） */
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
  extJson: string
): Promise<void> {
  if (!native) throw new Error('当前平台不支持圈组消息通道');
  await native.sendChannelText(serverId, channelId, text, extJson);
}

export async function pocketImObserveMessages(enable: boolean): Promise<void> {
  if (!native) return;
  await native.observeMessages(enable);
}

/** 圈组消息事件（原生 PocketIm:message 推送，元素为扁平化后的消息） */
export interface PocketImMessage {
  uuid: string;
  serverId: number;
  channelId: number;
  fromAccount: string;
  fromNick: string;
  time: number;
  content: string;
  /** remoteExtension 的 JSON 字符串 */
  extension: string;
}

const emitter = native ? new NativeEventEmitter(NativeModules.PocketIm) : null;

export function addPocketImMessageListener(
  listener: (messages: PocketImMessage[]) => void
): { remove: () => void } {
  if (!emitter) return { remove: () => undefined };
  const sub = emitter.addListener('PocketIm:message', listener);
  return { remove: () => sub.remove() };
}

export function addPocketImStatusListener(
  listener: (status: string) => void
): { remove: () => void } {
  if (!emitter) return { remove: () => undefined };
  const sub = emitter.addListener('PocketIm:status', listener);
  return { remove: () => sub.remove() };
}
