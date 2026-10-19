import { NativeModules, Platform } from 'react-native';

/**
 * 媒体时长探测桥（Android MediaMetadataRetriever）。
 * 房间语音消息体里没有 duration（实测只有 msgTime），只能由客户端解析；
 * 这里不创建播放器，单线程池读元数据，比隐藏 Video 探测稳定得多。
 */
type NativeMediaProbe = {
  getDurationSeconds(url: string, headers: Record<string, string>): Promise<number>;
};

const native: NativeMediaProbe | undefined =
  Platform.OS === 'android' ? (NativeModules as any).MediaProbe : undefined;

export const isMediaProbeAvailable = !!native;

/** 房间播放器统一防盗链头（与 playerSource 保持一致） */
export const ROOM_MEDIA_HEADERS = {
  'User-Agent': 'PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)',
  Referer: 'https://h5.48.cn/',
  Origin: 'https://h5.48.cn',
};

/** 解析媒体时长（秒）。读不到时 resolve 0，不抛错，避免污染 UI。 */
export function probeMediaDurationSeconds(url: string, headers: Record<string, string> = ROOM_MEDIA_HEADERS): Promise<number> {
  if (!native || !url) return Promise.resolve(0);
  return native.getDurationSeconds(url, headers).catch(() => 0);
}
