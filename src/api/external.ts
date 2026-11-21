import { BILIBILI_LIVE_CONFIG_URL } from '../constants';
import { BilibiliLiveRoom } from '../types';
import { fetchJson } from '../utils/network';
import { unwrapList } from '../utils/data';

interface BilibiliRoomRaw {
  roomId?: string | number;
  id?: string | number;
  name?: string;
  title?: string;
  roomName?: string;
  isLive?: boolean | number;
}

async function fetchList<T>(url: string, keys: string[] = [], cacheTtl = 0): Promise<T[]> {
  const res = await fetchJson<unknown>(url, cacheTtl);
  return unwrapList(res, keys) as T[];
}

export const externalApi = {
  async fetchBilibiliConfig(): Promise<BilibiliLiveRoom[]> {
    const rooms = await fetchList<BilibiliRoomRaw>(
      BILIBILI_LIVE_CONFIG_URL,
      ['rooms', 'data', 'content', 'list'],
      5 * 60 * 1000,
    );
    return rooms.map((room) => ({
      ...room,
      roomId: String(room.roomId || room.id || ''),
      name: String(room.name || room.title || room.roomName || room.roomId || ''),
      isLive: !!room.isLive,
    }));
  },
};
