import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, Member } from '../types';
import { APP_VERSION } from '../constants';
import { DEFAULT_SETTINGS } from '../services/settings';

interface SettingsState {
  settings: AppSettings;
  setSettings: (patch: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
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

// --- 版本更新检测 ---

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/Xenia0922/yaya_msg_mobile/releases/latest';
const UPDATE_TIMEOUT = 8000;
// 检查结果持久化，24h 内不重复打 GitHub API（未认证限流 60/h，冷启全打会快速耗尽）
const UPDATE_LAST_CHECK_KEY = 'yaya_update_last_check';
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

function parseVersion(v: string): number[] {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((seg) => parseInt(seg, 10))
    .filter((n) => !Number.isNaN(n));
}

/** candidate 是否比 current 新（纯数字段比较，如 2.6.6 > 2.6.5） */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

interface UpdateState {
  /** 是否有可用更新（本地版本低于 GitHub 最新 Release 版本） */
  hasUpdate: boolean;
  /** 最新版本号（如 v2.6.6），无更新时为空 */
  latestVersion: string;
  /** 最新版 APK 直链；Release 无 APK 附件时回退到 Release 页面 */
  latestUrl: string;
  /** 本次会话已检查的时间戳，0 表示未检查 */
  lastCheckedAt: number;
  checkUpdate: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  hasUpdate: false,
  latestVersion: '',
  latestUrl: '',
  lastCheckedAt: 0,
  // 应用启动时自动检测一次；失败（网络/无 Release/超时）静默视为无更新，
  // 绝不打扰用户 —— 没有红点就当作没有更新。
  checkUpdate: async () => {
    const { lastCheckedAt } = useUpdateStore.getState();
    // 合并内存与持久化的检查时间：24h 内已查过则直接跳过，避免每次冷启都请求 GitHub API
    const persisted = await AsyncStorage.getItem(UPDATE_LAST_CHECK_KEY).catch(() => null);
    const persistedTs = persisted ? Number(persisted) || 0 : 0;
    const lastTs = Math.max(lastCheckedAt, persistedTs);
    if (lastTs && Date.now() - lastTs < UPDATE_CHECK_INTERVAL) return;
    const now = Date.now();
    set({ lastCheckedAt: now });
    AsyncStorage.setItem(UPDATE_LAST_CHECK_KEY, String(now)).catch(() => {});
    try {
      const res = await Promise.race([
        fetch(GITHUB_RELEASES_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'yaya-msg-mobile' } }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), UPDATE_TIMEOUT)),
      ]);
      if (!res.ok) { set({ hasUpdate: false, latestVersion: '', latestUrl: '' }); return; }
      const data: any = await res.json();
      const tag = String(data.tag_name || data.name || '');
      const apk = (data.assets || []).find((a: any) => String(a.name || '').toLowerCase().endsWith('.apk'));
      const url = String(apk?.browser_download_url || data.html_url || '');
      const has = !!tag && !!url && isNewerVersion(tag, APP_VERSION);
      set({ hasUpdate: has, latestVersion: has ? tag : '', latestUrl: has ? url : '' });
    } catch {
      set({ hasUpdate: false, latestVersion: '', latestUrl: '' });
    }
  },
}));
