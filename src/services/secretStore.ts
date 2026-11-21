import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptSecret, decryptSecret, isSecureVaultAvailable } from '../native/SecureVault';

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

  cache = map;
}

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

        if (enc == null) throw new Error('安全存储不可用，已拒绝保存敏感凭证');
        map[key] = `${ENC_PREFIX}${enc}`;
      }
      await writeMap(map);
    });
  writeChain = op;
  await op;
}

export async function getSecret(key: string): Promise<string> {
  let map: SecretMap;
  try {
    map = await readMap();
  } catch {
    return '';
  }
  const v = map[key];
  if (!v) return '';
  if (!v.startsWith(ENC_PREFIX)) return v;
  const plain = await decryptSecret(v.slice(ENC_PREFIX.length));
  return plain == null ? '' : plain;
}

export async function deleteSecret(key: string): Promise<void> {
  await setSecret(key, '');
}

export function isSecretStorageEncrypted(): boolean {
  return isSecureVaultAvailable;
}
