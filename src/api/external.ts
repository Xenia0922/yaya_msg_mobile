import {
  MEMBERS_URL,
  BILIBILI_LIVE_CONFIG_URL,
  LYRICS_INDEX_URL,
  NOTICE_URL,
  YK1Z_URL,
  LYRICS_BASE_URL,
} from '../constants';
import {
  AudioProgram,
  BilibiliLiveRoom,
  Member,
  MusicItem,
  VideoItem,
} from '../types';
import { fetchJson } from '../utils/network';
import { getPath, unwrapList } from '../utils/data';

async function fetchList<T>(url: string, keys: string[] = []): Promise<T[]> {
  const res = await fetchJson<any>(url);
  return unwrapList(res, keys) as T[];
}

async function fetchNamedList<T>(url: string, keys: string[]): Promise<T[]> {
  const res = await fetchJson<any>(url);
  for (const key of keys) {
    const value = getPath(res, key);
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

export const externalApi = {
  async fetchMembers(): Promise<Member[]> {
    return fetchList<Member>(MEMBERS_URL, ['members', 'data', 'content', 'list']);
  },

  async fetchBilibiliConfig(): Promise<BilibiliLiveRoom[]> {
    const rooms = await fetchList<any>(BILIBILI_LIVE_CONFIG_URL, ['rooms', 'data', 'content', 'list']);
    return rooms.map((room) => ({
      ...room,
      roomId: String(room.roomId || room.id || ''),
      name: String(room.name || room.title || room.roomName || room.roomId || ''),
      isLive: !!room.isLive,
    }));
  },

  async fetchLyricsIndex(): Promise<Record<string, string>> {
    const res = await fetchJson<any>(LYRICS_INDEX_URL);
    return res || {};
  },

  async fetchLyric(pathOrName: string): Promise<string> {
    const path = pathOrName.startsWith('http')
      ? pathOrName
      : `${LYRICS_BASE_URL}/${pathOrName.replace(/^\/+/, '')}`;
    return fetchJson<any>(path) as any;
  },

  async fetchNotice(): Promise<any> {
    return fetchJson<any>(NOTICE_URL);
  },

  async fetchYk1zConfig(): Promise<any> {
    return fetchJson<any>(YK1Z_URL);
  },

  async fetchVideos(): Promise<VideoItem[]> {
    return fetchNamedList<VideoItem>(YK1Z_URL, ['videos', 'videoList', 'resources.videos']);
  },

  async fetchMusic(): Promise<MusicItem[]> {
    return fetchNamedList<MusicItem>(YK1Z_URL, ['music', 'musicList', 'resources.music']);
  },

  async fetchAudioPrograms(): Promise<AudioProgram[]> {
    return fetchNamedList<AudioProgram>(YK1Z_URL, ['audioPrograms', 'programs', 'resources.audioPrograms', 'resources.radio']);
  },
};
