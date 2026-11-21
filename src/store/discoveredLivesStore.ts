import { create } from 'zustand';
import pocketApi from '../api/pocket48';
import type { VODItem } from '../types';
import { pickPlayableUrls } from '../screens/media/parsing';

export type DiscoveredLiveItem = VODItem & {
  userId?: string;
  discoveredAt: number;
};

const MAX_DISCOVERED_LIVES = 30;
const DISCOVERED_TTL_MS = 8 * 60 * 60 * 1000;

interface DiscoveredLivesState {
  items: DiscoveredLiveItem[];
  addDiscoveredLive: (item: Omit<DiscoveredLiveItem, 'discoveredAt'>) => void;
  removeDiscoveredLive: (liveId: string) => void;
  revalidate: () => Promise<void>;
}

function pruneItems(items: DiscoveredLiveItem[], now = Date.now()): DiscoveredLiveItem[] {
  return items
    .filter((it) => it.liveId && now - it.discoveredAt < DISCOVERED_TTL_MS)
    .slice(0, MAX_DISCOVERED_LIVES);
}

export const useDiscoveredLivesStore = create<DiscoveredLivesState>((set, get) => ({
  items: [],

  addDiscoveredLive: (item) => {
    const lid = String(item.liveId || '').trim();
    if (!lid) return;
    const now = Date.now();
    set((state) => {
      const rest = state.items.filter((it) => String(it.liveId) !== lid);
      return {
        items: pruneItems([{ ...item, liveId: lid, discoveredAt: now }, ...rest], now),
      };
    });
  },

  removeDiscoveredLive: (liveId) => {
    const lid = String(liveId || '').trim();
    if (!lid) return;
    set((state) => {
      if (!state.items.some((it) => String(it.liveId) === lid)) return state;
      return { items: state.items.filter((it) => String(it.liveId) !== lid) };
    });
  },

  revalidate: async () => {
    const current = pruneItems(get().items);
    if (!current.length) {
      if (get().items.length) set({ items: [] });
      return;
    }
    const endedIds = new Set<string>();
    await Promise.all(
      current.map(async (entry) => {
        const lid = String(entry.liveId);
        const res =
          (await pocketApi.getLiveOne(lid).catch(() => null)) ||
          (await pocketApi.getOpenLiveOne(lid).catch(() => null));
        if (!res) return;
        const body = (res?.content || res?.data || res || {}) as Record<string, any>;
        const urls = pickPlayableUrls(res, true);
        if (Number(body.status) === 2 || !urls.length) {
          endedIds.add(lid);
        }
      }),
    );
    if (!endedIds.size) return;
    set((state) => ({
      items: state.items.filter((it) => !endedIds.has(String(it.liveId))),
    }));
  },
}));
