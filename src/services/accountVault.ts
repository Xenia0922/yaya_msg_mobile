import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveSettings } from './settings';
import { resetNimSession } from './pocketNim/session';
import { useSettingsStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { MusicEngine } from './musicPlayer';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { encryptSecret, decryptSecret } from '../native/SecureVault';

/**
 * 整账号快速切号（不是口袋的「大小号」）。
 *
 * 一个条目 = 一个完整登录态：token + 登录身份（口袋48 / 塞纳河48）。
 * 只存本机；**整块 JSON 用 AndroidKeyStore 加密后落盘**（不再明文），
 * 不在内存之外的任何地方暴露；不上传、不进日志。
 *
 * 存储格式：`v1:<base64 密文>`；无 `v1:` 前缀的是升级前的历史明文，读到时会自动重新加密。
 */
const VAULT_KEY = 'yaya_account_vault_v1';
const ENC_PREFIX = 'v1:';

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

/** 读出并解密原始 JSON；存储不存在返回 null，损坏/解密失败抛错（不能静默当空表） */
async function readDecrypted(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  if (!raw.startsWith(ENC_PREFIX)) {
    // 历史明文：读出来的同时顺手加密，避免明文长期留存。
    // 加密暂时不可用时仍允许本次读取，但不能把明文回写。
    try {
      await write(JSON.parse(raw) as SavedAccount[]);
    } catch {
      /* 保留原值，等下次可写时迁移 */
    }
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

/** 把当前登录态存进列表；同 token 只更新名字/身份，不重复添加 */
export function saveCurrentAccount(label = ''): Promise<SavedAccount[]> {
  return withVaultWrite(async () => {
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
  });
}

export function removeSavedAccount(id: string): Promise<SavedAccount[]> {
  return withVaultWrite(async () => {
    const accounts = await listSavedAccounts();
    return write(accounts.filter((item) => item.id !== id));
  });
}

/**
 * 一键切换整个账号：同时换 token + 登录身份，再按「换号」流程重置云信会话。
 * 顺序不能反：先写设置再 reset，否则原生通道会用旧 token 重建。
 */
export async function switchSavedAccount(entry: SavedAccount): Promise<void> {
  const token = String(entry?.token || '').trim();
  if (!token) throw new Error('该账号没有 Token');
  // 切号前先停掉「在途媒体」：音乐/电台/小窗都是跨页常驻的，若不停，
  // 会出现「用 A 的登录态继续播 B 的资源」以及系统媒体卡显示错乱（R-18）。
  // 下载队列不在此处理：下载 URL 是公开 CDN 资源、不随账号变化。
  try {
    useMiniPlayerStore.getState().close();
  } catch {
    /* ignore */
  }
  try {
    MusicEngine.stop();
    const music = useMusicPlayerStore.getState();
    if (music.playbackState !== 'idle') music.setPlaybackState('idle');
  } catch {
    /* ignore */
  }
  const patch = {
    p48Token: token,
    p48ClientProfile:
      entry.clientProfile === 'seine48' ? ('seine48' as const) : ('pocket48' as const),
  };
  useSettingsStore.getState().setSettings(patch);
  await saveSettings(patch);
  resetNimSession('快速切号');
}
