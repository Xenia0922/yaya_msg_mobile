import { NativeModules, Platform } from 'react-native';

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
    Native.playEffect({
      zipPath: payload.zipPath,
      zipMd5: payload.zipMd5 || '',
      giftName: payload.giftName || '',
    });
  } catch {}
}

export function clearGiftEffectQueue(): void {
  if (!isGiftEffectSupported()) return;
  try {
    Native.clearQueue?.();
  } catch {}
}
