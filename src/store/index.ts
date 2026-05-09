import { create } from 'zustand';
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
  setTabBarHidden: (hidden: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  tabBarHidden: false,
  setTabBarHidden: (hidden) => set({ tabBarHidden: hidden }),
}));

interface AppState {
  isLoggedIn: boolean;
  currentView: string;
  messageFilter: string;
  selectedMember: Member | null;
  searchQuery: string;
  searchUser: string;
  dateYear: string;
  dateMonth: string;
  dateDay: string;
  sortOrder: 'asc' | 'desc';
  setIsLoggedIn: (v: boolean) => void;
  setCurrentView: (v: string) => void;
  setMessageFilter: (v: string) => void;
  setSelectedMember: (m: Member | null) => void;
  setSearchQuery: (v: string) => void;
  setSearchUser: (v: string) => void;
  setDateYear: (v: string) => void;
  setDateMonth: (v: string) => void;
  setDateDay: (v: string) => void;
  setSortOrder: (v: 'asc' | 'desc') => void;
}

export const useAppStore = create<AppState>((set) => ({
  isLoggedIn: false,
  currentView: 'home',
  messageFilter: 'all',
  selectedMember: null,
  searchQuery: '',
  searchUser: '',
  dateYear: 'all',
  dateMonth: 'all',
  dateDay: 'all',
  sortOrder: 'desc',
  setIsLoggedIn: (v) => set({ isLoggedIn: v }),
  setCurrentView: (v) => set({ currentView: v }),
  setMessageFilter: (v) => set({ messageFilter: v }),
  setSelectedMember: (m) => set({ selectedMember: m }),
  setSearchQuery: (v) => set({ searchQuery: v }),
  setSearchUser: (v) => set({ searchUser: v }),
  setDateYear: (v) => set({ dateYear: v }),
  setDateMonth: (v) => set({ dateMonth: v }),
  setDateDay: (v) => set({ dateDay: v }),
  setSortOrder: (v) => set({ sortOrder: v }),
}));
