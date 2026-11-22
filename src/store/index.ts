import { create } from 'zustand';
import { parseMaybeJson } from '../utils/data';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, Member } from '../types';
import { APP_VERSION } from '../constants';
import { IS_PLUS_BUILD } from '../constants/channel';
import { DEFAULT_SETTINGS } from '../services/settings';
import {
  UpdateCache,
  evaluateUpdateFromCache,
  isNewerVersion,
  localTodayKey,
  parseUpdateCache,
  shouldPromptDailyUpdate,
} from '../utils/updateCache';

export { localTodayKey, parseUpdateCache, isNewerVersion };

interface SettingsState {
  settings: AppSettings;
  setSettings: (patch: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
}));

interface MemberState {
  members: Member[];
  membersLoaded: boolean;
  setMembers: (members: Member[]) => void;
  updateMemberRoomIds: (
    channelId: string,
    patch: Partial<Pick<Member, 'serverId' | 'channelId' | 'yklzId'>>,
  ) => void;

  batchUpdateSmallRooms: (updates: Array<{ channelId: string; yklzId: string }>) => void;

  patchMemberByUserId: (
    memberId: string,
    patch: Partial<Pick<Member, 'serverId' | 'channelId' | 'yklzId' | 'roomId' | 'liveRoomId'>>,
  ) => void;
}

export const useMemberStore = create<MemberState>((set) => ({
  members: [],
  membersLoaded: false,
  setMembers: (members) => set({ members, membersLoaded: true }),
  updateMemberRoomIds: (channelId, patch) =>
    set((state) => ({
      members: state.members.map((member) =>
        String(member.channelId) === String(channelId) ? { ...member, ...patch } : member,
      ),
    })),
  batchUpdateSmallRooms: (updates) => {
    if (!updates.length) return;
    const byChannel = new Map<string, string>();
    for (const item of updates) {
      if (item.channelId && item.yklzId) byChannel.set(String(item.channelId), item.yklzId);
    }
    if (!byChannel.size) return;
    set((state) => ({
      members: state.members.map((member) => {
        const yklzId = byChannel.get(String(member.channelId));
        return yklzId && member.yklzId !== yklzId ? { ...member, yklzId } : member;
      }),
    }));
  },
  patchMemberByUserId: (memberId, patch) =>
    set((state) => ({
      members: state.members.map((member) =>
        String(member.id) === String(memberId) ? { ...member, ...patch } : member,
      ),
    })),
}));

interface UiState {
  tabBarHiddenByRoute: { Media: boolean; Rooms: boolean };
  toastMessage: string;
  toastTone: 'success' | 'error' | 'info' | null;

  screenBackdrop: { uri: string; scrim: string } | null;
  pmUnread: number;
  setTabBarHidden: (hidden: boolean, route: 'Media' | 'Rooms') => void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  hideToast: () => void;
  setScreenBackdrop: (v: { uri: string; scrim: string } | null) => void;
  setPmUnread: (count: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  tabBarHiddenByRoute: { Media: false, Rooms: false },
  toastMessage: '',
  toastTone: null,
  screenBackdrop: null,
  pmUnread: 0,
  setTabBarHidden: (hidden, route) =>
    set((state) =>
      state.tabBarHiddenByRoute[route] === hidden
        ? state
        : { tabBarHiddenByRoute: { ...state.tabBarHiddenByRoute, [route]: hidden } },
    ),
  showToast: (message, tone) => set({ toastMessage: message, toastTone: tone ?? null }),
  hideToast: () => set({ toastMessage: '', toastTone: null }),
  setScreenBackdrop: (v) =>
    set((state) => {
      const prev = state.screenBackdrop;
      if (prev === v) return state;
      if (prev && v && prev.uri === v.uri && prev.scrim === v.scrim) return state;
      return { screenBackdrop: v };
    }),
  setPmUnread: (count) =>
    set((state) => {
      const normalized = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
      return state.pmUnread === normalized ? state : { pmUnread: normalized };
    }),
}));

const ANNOUNCEMENT_SEEN_KEY = 'yaya_announcement_seen';

interface AnnouncementState {
  seenIds: string[];
  lastFetched: number;
  hydrated: boolean;
  markSeen: (id: string) => void;
  setLastFetched: (ts: number) => void;
}

export const useAnnouncementStore = create<AnnouncementState>((set) => ({
  seenIds: [],
  lastFetched: 0,
  hydrated: false,
  markSeen: (id) =>
    set((state) => {
      if (state.seenIds.includes(id)) return {};
      const next = [...state.seenIds, id];
      AsyncStorage.setItem(ANNOUNCEMENT_SEEN_KEY, JSON.stringify(next)).catch(() => {});
      return { seenIds: next };
    }),
  setLastFetched: (ts) => set({ lastFetched: ts }),
}));

AsyncStorage.getItem(ANNOUNCEMENT_SEEN_KEY)
  .then((raw) => {
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (Array.isArray(ids) && ids.length) {
      useAnnouncementStore.setState({ seenIds: ids });
    }
  })
  .catch(() => {})
  .finally(() => {
    useAnnouncementStore.setState({ hydrated: true });
  });

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/Xenia0922/yaya_msg_mobile/releases/latest';

const GITHUB_RELEASES_PAGE = 'https://github.com/Xenia0922/yaya_msg_mobile/releases/latest';

const UPDATE_DOWNLOAD_PAGE = 'https://gnz48.tech/app/';
const UPDATE_TIMEOUT = 8000;

const UPDATE_LAST_CHECK_KEY = 'yaya_update_last_check';
const UPDATE_PROMPT_DATE_KEY = 'yaya_update_prompt_date';

interface UpdateState {
  hasUpdate: boolean;

  latestVersion: string;

  latestUrl: string;

  releaseNotes: string;

  lastCheckedAt: number;

  lastCheckedDate: string;

  pendingDailyPrompt: boolean;
  checkUpdate: (force?: boolean) => Promise<boolean>;
  markDailyPromptShown: () => Promise<void>;
}

let updateChecking = false;
let updateCheckSeq = 0;

export const useUpdateStore = create<UpdateState>((set) => ({
  hasUpdate: false,
  latestVersion: '',
  latestUrl: '',
  releaseNotes: '',
  lastCheckedAt: 0,
  lastCheckedDate: '',
  pendingDailyPrompt: false,

  markDailyPromptShown: async () => {
    const today = localTodayKey();
    set({ pendingDailyPrompt: false });
    await AsyncStorage.setItem(UPDATE_PROMPT_DATE_KEY, today).catch(() => {});
  },

  checkUpdate: async (force = false) => {
    if (IS_PLUS_BUILD) {
      set({
        hasUpdate: false,
        latestVersion: '',
        latestUrl: '',
        releaseNotes: '',
        lastCheckedAt: Date.now(),
        lastCheckedDate: localTodayKey(),
        pendingDailyPrompt: false,
      });
      return false;
    }

    if (updateChecking && !force) return false;

    updateChecking = true;
    const seq = ++updateCheckSeq;
    const { lastCheckedAt } = useUpdateStore.getState();
    const today = localTodayKey();

    const pairs = await AsyncStorage.multiGet([
      UPDATE_LAST_CHECK_KEY,
      UPDATE_PROMPT_DATE_KEY,
    ]).catch(() => [] as [string, string | null][]);
    const cacheRaw = pairs.find(([k]) => k === UPDATE_LAST_CHECK_KEY)?.[1] ?? null;
    const promptedDate = pairs.find(([k]) => k === UPDATE_PROMPT_DATE_KEY)?.[1] ?? '';
    const cached = parseUpdateCache(cacheRaw);

    if (!force && cached.checkedDate === today) {
      const evaluated = evaluateUpdateFromCache(
        cached,
        APP_VERSION,
        promptedDate,
        today,
        UPDATE_DOWNLOAD_PAGE,
      );
      if (seq === updateCheckSeq) {
        set({
          ...evaluated,
          lastCheckedAt: cached.checkedAt || lastCheckedAt,
          lastCheckedDate: today,
        });
        updateChecking = false;
      }
      return evaluated.hasUpdate;
    }

    const commit = (has: boolean, tag: string, url: string, notes: string, persist: boolean) => {
      if (seq !== updateCheckSeq) return;
      const now = Date.now();
      set({
        hasUpdate: has,
        latestVersion: has ? tag : '',
        latestUrl: has ? url : '',
        releaseNotes: has ? notes : '',
        lastCheckedAt: now,
        lastCheckedDate: persist ? today : cached.checkedDate,
        pendingDailyPrompt: shouldPromptDailyUpdate({
          hasUpdate: has,
          force,
          promptedDate,
          today,
        }),
      });
      if (persist) {
        const nextCache: UpdateCache = {
          checkedDate: today,
          checkedAt: now,
          latestTag: tag,
          latestUrl: url,
          releaseNotes: notes,
        };
        AsyncStorage.setItem(UPDATE_LAST_CHECK_KEY, JSON.stringify(nextCache)).catch(() => {});
      }
    };

    try {
      let tag = '';
      let notes = '';
      try {
        const res = await Promise.race([
          fetch(GITHUB_RELEASES_URL, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'yaya-msg-mobile' },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), UPDATE_TIMEOUT),
          ),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = parseMaybeJson(await res.text());
        tag = String(data.tag_name || data.name || '');
        notes = typeof data.body === 'string' ? data.body.trim() : '';
      } catch {
        const UA =
          'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
        const page = await Promise.race([
          fetch(GITHUB_RELEASES_PAGE, { headers: { 'User-Agent': UA } }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), UPDATE_TIMEOUT + 2000),
          ),
        ]);
        if (!page.ok) throw new Error(`HTTP ${page.status}`);
        const finalUrl = page.url || GITHUB_RELEASES_PAGE;
        const tagMatch = finalUrl.match(/\/releases\/tag\/([^/?#]+)/);
        tag = tagMatch ? decodeURIComponent(tagMatch[1]) : '';
        if (!tag) throw new Error('page missing tag');
      }

      const has = !!tag && isNewerVersion(tag, APP_VERSION);
      commit(has, tag, has ? UPDATE_DOWNLOAD_PAGE : '', has ? notes : '', true);
      return has;
    } catch {
      const cachedHas = !!cached.latestTag && isNewerVersion(cached.latestTag, APP_VERSION);
      if (cachedHas) {
        commit(
          true,
          cached.latestTag,
          cached.latestUrl || UPDATE_DOWNLOAD_PAGE,
          cached.releaseNotes,
          false,
        );
        return true;
      }
      commit(false, '', '', '', false);
      return false;
    } finally {
      if (seq === updateCheckSeq) updateChecking = false;
    }
  },
}));
