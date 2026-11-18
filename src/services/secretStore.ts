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
 * - 原生加密模块异常时 fail-closed（拒绝明文落盘），旧的无前缀历史明文仍可读；
 * - 解密失败按「空」返回，绝不把损坏密文当明文使用。
 */
const SECRETS_KEY = 'yaya_secrets_v1';
const ENC_PREFIX = 'v1:';

type SecretMap = Record<string, string>;

let cache: SecretMap | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function readMap(): Promise<SecretMap> {
  if (cache) return { ...cache };
  const raw = await AsyncStorage.getItem(SECRETS_KEY);
  if (!raw) {
    cache = {};
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 读取/解析失败不能当成空表：否则下一次 setSecret 会用只含一条的新对象
    // 覆盖掉整仓历史凭据（GitHub 等密钥直接丢失）。抛错让上层显式处理。
    throw new Error('敏感凭证存储损坏，无法读取');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('敏感凭证存储格式异常');
  }
  cache = parsed as SecretMap;
  return { ...cache };
}

async function writeMap(map: SecretMap): Promise<void> {
  await AsyncStorage.setItem(SECRETS_KEY, JSON.stringify(map));
  // 写入成功后才更新缓存，避免 setItem 失败时内存显示“已保存”、重启后丢失。
  cache = map;
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
        // 禁止 fail-open：加密模块异常时绝不能把 token/cookie 明文落盘。
        // 开发/iOS 无原生模块的场景由 SecureVault 显式声明不可用；Android 正式包必须加密。
        if (enc == null) throw new Error('安全存储不可用，已拒绝保存敏感凭证');
        map[key] = `${ENC_PREFIX}${enc}`;
      }
      await writeMap(map);
    });
  writeChain = op;
  await op;
}

/** 读取一条；不存在或解不开返回 '' */
export async function getSecret(key: string): Promise<string> {
  let map: SecretMap;
  try {
    map = await readMap();
  } catch {
    // 存储损坏时读取按“无此凭据”处理，避免阻断应用启动；
    // 写入路径仍会因 readMap 抛错而拒绝覆盖原数据。
    return '';
  }
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
