import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveSettings } from './settings';
import { resetNimSession } from './pocketNim/session';
import { useSettingsStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine } from './musicPlayer';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { encryptSecret, decryptSecret } from '../native/SecureVault';
import { normalizePocketDeviceId, normalizePocketToken } from '../utils/pocketToken';
import { resolveBoundPocketDeviceId } from '../api/pocketHeaders';

const VAULT_KEY = 'yaya_account_vault_v1';
const ENC_PREFIX = 'v1:';

export type SavedAccount = {
  id: string;
  label: string;
  token: string;
  deviceId?: string;
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

let vaultWriteChain: Promise<unknown> = Promise.resolve();
function withVaultWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = vaultWriteChain.then(fn);
  vaultWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function write(accounts: SavedAccount[]): Promise<SavedAccount[]> {
  const json = JSON.stringify(accounts);
  const enc = await encryptSecret(json);
  if (enc == null) throw new Error('安全存储不可用，已拒绝保存账号');
  await AsyncStorage.setItem(VAULT_KEY, `${ENC_PREFIX}${enc}`);
  return accounts;
}

async function readDecrypted(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  if (!raw.startsWith(ENC_PREFIX)) {
    try {
      await write(JSON.parse(raw) as SavedAccount[]);
    } catch {}
    return raw;
  }
  const plain = await decryptSecret(raw.slice(ENC_PREFIX.length));
  if (plain == null) throw new Error('账号仓库解密失败，请重新登录');
  return plain;
}

export async function listSavedAccounts(): Promise<SavedAccount[]> {
  const json = await readDecrypted();
  if (!json) return [];
  let list: unknown;
  try {
    list = JSON.parse(json);
  } catch {
    throw new Error('账号仓库数据损坏');
  }
  return Array.isArray(list) ? (list as SavedAccount[]).filter((item) => item && item.token) : [];
}

export function saveCurrentAccount(label = ''): Promise<SavedAccount[]> {
  return withVaultWrite(async () => {
    const { p48Token, p48DeviceId } = useSettingsStore.getState().settings;
    const token = normalizePocketToken(p48Token);
    if (!token) return listSavedAccounts();
    const deviceId =
      normalizePocketDeviceId(p48DeviceId) ||
      normalizePocketDeviceId(await resolveBoundPocketDeviceId());
    const accounts = await listSavedAccounts();
    const id = tokenId(token);
    const index = accounts.findIndex((item) => item.id === id);
    const prev = index >= 0 ? accounts[index] : null;
    const now = new Date();
    const stamp = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const entry: SavedAccount = {
      id,

      label: String(label || '').trim() || prev?.label || `账号 ${stamp}`,
      token,
      ...(deviceId ? { deviceId } : {}),
      clientProfile: 'pocket48',
      addedAt: prev?.addedAt ?? Date.now(),
    };
    if (prev) accounts[index] = entry;
    else accounts.push(entry);
    return write(accounts);
  });
}

export function removeSavedAccount(id: string): Promise<SavedAccount[]> {
  return withVaultWrite(async () => {
    const accounts = await listSavedAccounts();
    return write(accounts.filter((item) => item.id !== id));
  });
}

export async function switchSavedAccount(entry: SavedAccount): Promise<void> {
  const token = normalizePocketToken(entry?.token);
  if (!token) throw new Error('该账号没有 Token');

  try {
    useMiniPlayerStore.getState().close();
  } catch {}
  try {
    MusicEngine.stop();
    const music = useMusicPlayerStore.getState();
    if (music.playbackState !== 'idle') music.setPlaybackState('idle');
  } catch {}
  const patch = {
    p48Token: token,
    p48DeviceId: normalizePocketDeviceId(entry?.deviceId),
    p48ClientProfile: 'pocket48' as const,
  };
  useSettingsStore.getState().setSettings(patch);
  await saveSettings(patch);
  resetNimSession('快速切号');
}
