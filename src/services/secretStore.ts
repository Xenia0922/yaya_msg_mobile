import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptSecret, decryptSecret, isSecureVaultAvailable } from '../native/SecureVault';

/**
 * 本机敏感凭证仓（token / cookie / meet48Auth / 多账号 vault）。
 *
 * 存储格式：AsyncStorage 单键 `yaya_secrets_v1` 内放一个 { key: 密文 } 的 JSON 对象。
 * 密文带 `v1:` 前缀，用于区分「已加密」与「历史明文」（兼容升级前的旧数据）。
 *
 * 设计要点：
 * - 写入串行化（writeChain），避免并发写互相覆盖；
 * - 内存缓存整张表，读取不重复解 JSON；
 * - 原生加密模块不可用时降级为无前缀明文（仅开发/iOS，Android 正式包不会走到）；
 * - 解密失败一律按「空」返回，绝不抛错打断启动。
 */
const SECRETS_KEY = 'yaya_secrets_v1';
const ENC_PREFIX = 'v1:';

type SecretMap = Record<string, string>;

let cache: SecretMap | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function readMap(): Promise<SecretMap> {
  if (cache) return { ...cache };
  try {
    const raw = await AsyncStorage.getItem(SECRETS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? (parsed as SecretMap) : {};
  } catch {
    cache = {};
  }
  return { ...cache };
}

async function writeMap(map: SecretMap): Promise<void> {
  cache = map;
  await AsyncStorage.setItem(SECRETS_KEY, JSON.stringify(map));
}

/** 写入一条（空字符串 = 删除该条） */
export async function setSecret(key: string, plain: string): Promise<void> {
  const op = writeChain
    .catch(() => undefined)
    .then(async () => {
      const map = await readMap();
      if (!plain) {
        if (map[key] === undefined) return;
        delete map[key];
      } else {
        const enc = await encryptSecret(plain);
        // enc 为 null 时（无原生模块）降级为明文，保持功能可用
        map[key] = enc == null ? plain : `${ENC_PREFIX}${enc}`;
      }
      await writeMap(map);
    });
  writeChain = op;
  await op;
}

/** 读取一条；不存在或解不开返回 '' */
export async function getSecret(key: string): Promise<string> {
  const map = await readMap();
  const v = map[key];
  if (!v) return '';
  if (!v.startsWith(ENC_PREFIX)) return v; // 历史明文（尚未迁移）
  const plain = await decryptSecret(v.slice(ENC_PREFIX.length));
  return plain == null ? '' : plain;
}

export async function deleteSecret(key: string): Promise<void> {
  await setSecret(key, '');
}

/** 当前平台是否具备加密能力（用于设置页/诊断展示） */
export function isSecretStorageEncrypted(): boolean {
  return isSecureVaultAvailable;
}
