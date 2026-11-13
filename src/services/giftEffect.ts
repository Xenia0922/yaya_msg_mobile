import { NativeModules, Platform } from 'react-native';

/**
 * 礼物全屏特效（libpag）桥，仅直播页使用。
 *
 * 数据来源：直播间聊天室 PRESENT_FULLSCREEN(_TWO) 消息的 giftInfo
 *   zipPath（如 /backstage/2023/1020/xxx.zip）→ 原生拼 https://source.48.cn 下载
 *   zipMd5 → 原生校验后解压出 giftpag.pag 播放（缓存 cacheDir/pag_effects）
 * 串行队列、同一礼物 30s 内不重复；自己送的和别人送的都会播（服务端广播回投给发送者）。
 */
const Native = (NativeModules as any)?.PocketGiftEffect;

export interface GiftEffectPayload {
  zipPath: string;
  zipMd5?: string;
  giftName?: string;
}

export function isGiftEffectSupported(): boolean {
  return Platform.OS === 'android' && !!Native?.playEffect;
}

export function playGiftEffect(payload: GiftEffectPayload): void {
  if (!isGiftEffectSupported() || !payload.zipPath) return;
  try {
    Native.playEffect({ zipPath: payload.zipPath, zipMd5: payload.zipMd5 || '', giftName: payload.giftName || '' });
  } catch {
    /* ignore */
  }
}

/** 退出直播间/切房时清空待播队列 */
export function clearGiftEffectQueue(): void {
  if (!isGiftEffectSupported()) return;
  try {
    Native.clearQueue?.();
  } catch {
    /* ignore */
  }
}
