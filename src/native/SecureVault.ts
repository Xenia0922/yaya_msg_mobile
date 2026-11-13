import { NativeModules, Platform } from 'react-native';

/**
 * 敏感凭证加密桥（Android 原生 SecureVaultModule：AndroidKeyStore + AES-256-GCM）。
 *
 * 只用于「落盘那一份」：磁盘上只存密文，密钥不可导出。
 * 内存中仍是明文，因此「复制 Token」等用户功能完全不受影响。
 *
 * iOS / 原生模块缺失时 encryptSecret 返回 null，由调用方降级为明文保存
 * （开发环境与 iOS 不因此中断；Android 正式包始终可用）。
 */
type NativeSecureVault = {
  encrypt(plain: string): Promise<string>;
  decrypt(payload: string): Promise<string | null>;
};

const native: NativeSecureVault | undefined =
  Platform.OS === 'android' ? ((NativeModules as any)?.SecureVault as NativeSecureVault | undefined) : undefined;

export const isSecureVaultAvailable = !!native;

/** 加密为可落盘字符串；原生不可用或失败返回 null */
export function encryptSecret(plain: string): Promise<string | null> {
  if (!native) return Promise.resolve(null);
  return native.encrypt(plain).catch(() => null);
}

/** 解密；失败（密钥失效/数据损坏）返回 null，调用方按「无凭据」处理 */
export function decryptSecret(payload: string): Promise<string | null> {
  if (!native) return Promise.resolve(null);
  return native.decrypt(payload).catch(() => null);
}
