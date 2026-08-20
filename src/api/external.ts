import {
  BILIBILI_LIVE_CONFIG_URL,
} from '../constants';
import {
  BilibiliLiveRoom,
} from '../types';
import { fetchJson } from '../utils/network';
import { unwrapList } from '../utils/data';

async function fetchList<T>(url: string, keys: string[] = [], cacheTtl = 0): Promise<T[]> {
  const res = await fetchJson<any>(url, cacheTtl);
  return unwrapList(res, keys) as T[];
}

export const externalApi = {
  /**
   * B站直播官方房间配置（低频变化）：
   * 会话内 5 分钟 TTL 内存缓存，避免反复进出直播页重复拉取。
   */
  async fetchBilibiliConfig(): Promise<BilibiliLiveRoom[]> {
    const rooms = await fetchList<any>(BILIBILI_LIVE_CONFIG_URL, ['rooms', 'data', 'content', 'list'], 5 * 60 * 1000);
    return rooms.map((room) => ({
      ...room,
      roomId: String(room.roomId || room.id || ''),
      name: String(room.name || room.title || room.roomName || room.roomId || ''),
      isLive: !!room.isLive,
    }));
  },
};
