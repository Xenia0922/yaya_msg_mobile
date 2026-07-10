import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, Member } from '../types';

interface SettingsState {
  settings: AppSettings;
  setSettings: (patch: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    theme: 'light',
    p48Token: '',
    bilibiliCookie: '',
    bilibiliUserInfo: null,
    msg_sort_order: 'desc',
    yaya_followed_custom_order: [],
    yaya_music_play_mode: 'sequential',
    yaya_music_volume: 0.7,
    yaya_audio_program_play_mode: 'sequential',
    yaya_auto_checkin_enabled: false,
    yaya_auto_checkin_last_date: '',
    yaya_auto_checkin_last_user: '',
    customBackgroundFile: '',
    customBackgroundUpdatedAt: 0,
    yaya_trip_show_all: false,
    meet48Auth: null,
  },
  setSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
}));

interface MemberState {
  members: Member[];
  membersLoaded: boolean;
  setMembers: (members: Member[]) => void;
  updateMemberRoomIds: (channelId: string, patch: Partial<Pick<Member, 'serverId' | 'channelId' | 'yklzId'>>) => void;
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
}));

interface UiState {
  tabBarHidden: boolean;
  toastMessage: string;
  setTabBarHidden: (hidden: boolean) => void;
  showToast: (message: string) => void;
  hideToast: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  tabBarHidden: false,
  toastMessage: '',
  setTabBarHidden: (hidden) => set({ tabBarHidden: hidden }),
  showToast: (message) => set({ toastMessage: message }),
  hideToast: () => set({ toastMessage: '' }),
}));

// --- v2.6: Announcement store ---

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

// Persist seen announcement ids so the modal doesn't re-pop on every cold launch.
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
