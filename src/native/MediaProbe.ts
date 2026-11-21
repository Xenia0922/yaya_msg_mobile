import { NativeModules, Platform } from 'react-native';
import { USER_AGENT } from '../constants';

type NativeMediaProbe = {
  getDurationSeconds(url: string, headers: Record<string, string>): Promise<number>;
};

const native: NativeMediaProbe | undefined =
  Platform.OS === 'android' ? (NativeModules as any).MediaProbe : undefined;

export const isMediaProbeAvailable = !!native;

export const ROOM_MEDIA_HEADERS = {
  'User-Agent': USER_AGENT,
  Referer: 'https://h5.48.cn/',
  Origin: 'https://h5.48.cn',
};

export function probeMediaDurationSeconds(
  url: string,
  headers: Record<string, string> = ROOM_MEDIA_HEADERS,
): Promise<number> {
  if (!native || !url) return Promise.resolve(0);
  return native.getDurationSeconds(url, headers).catch(() => 0);
}
