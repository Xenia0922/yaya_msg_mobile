import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveSettings } from './settings';
import { resetNimSession } from './pocketNim/session';
import { useSettingsStore } from '../store';

/**
 * 整账号快速切号（不是口袋的「大小号」）。
 *
 * 一个条目 = 一个完整登录态：token + 登录身份（口袋48 / 塞纳河48）。
 * 只存本机 AsyncStorage，明文与现有 p48Token 一致；不上传、不进日志。
 */
const VAULT_KEY = 'yaya_account_vault_v1';

export type SavedAccount = {
  id: string;
  label: string;
  token: string;
  clientProfile: 'pocket48' | 'seine48';
  addedAt: number;
};

function tokenId(token: string): string {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function write(accounts: SavedAccount[]): Promise<SavedAccount[]> {
  await AsyncStorage.setItem(VAULT_KEY, JSON.stringify(accounts));
  return accounts;
}

export async function listSavedAccounts(): Promise<SavedAccount[]> {
  try {
    const raw = await AsyncStorage.getItem(VAULT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((item) => item && item.token) : [];
  } catch {
    return [];
  }
}

/** 把当前登录态存进列表；同 token 只更新名字/身份，不重复添加 */
export async function saveCurrentAccount(label = ''): Promise<SavedAccount[]> {
  const { p48Token, p48ClientProfile } = useSettingsStore.getState().settings;
  const token = String(p48Token || '').trim();
  if (!token) return listSavedAccounts();
  const accounts = await listSavedAccounts();
  const id = tokenId(token);
  const index = accounts.findIndex((item) => item.id === id);
  const prev = index >= 0 ? accounts[index] : null;
  const now = new Date();
  const stamp = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const entry: SavedAccount = {
    id,
    // 自动保存（不传名字）时保留已有名字；新账号用时间做默认名，避免一串「账号 1/2/3」
    label: String(label || '').trim() || prev?.label || `账号 ${stamp}`,
    token,
    clientProfile: p48ClientProfile === 'seine48' ? 'seine48' : 'pocket48',
    addedAt: prev?.addedAt ?? Date.now(),
  };
  if (prev) accounts[index] = entry;
  else accounts.push(entry);
  return write(accounts);
}

export async function removeSavedAccount(id: string): Promise<SavedAccount[]> {
  const accounts = await listSavedAccounts();
  return write(accounts.filter((item) => item.id !== id));
}

/**
 * 一键切换整个账号：同时换 token + 登录身份，再按「换号」流程重置云信会话。
 * 顺序不能反：先写设置再 reset，否则原生通道会用旧 token 重建。
 */
export async function switchSavedAccount(entry: SavedAccount): Promise<void> {
  const token = String(entry?.token || '').trim();
  if (!token) throw new Error('该账号没有 Token');
  const patch = {
    p48Token: token,
    p48ClientProfile: entry.clientProfile === 'seine48' ? ('seine48' as const) : ('pocket48' as const),
  };
  useSettingsStore.getState().setSettings(patch);
  await saveSettings(patch);
  resetNimSession('快速切号');
}
