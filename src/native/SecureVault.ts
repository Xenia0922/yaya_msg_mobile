import { NativeModules, Platform } from 'react-native';

type NativeSecureVault = {
  encrypt(plain: string): Promise<string>;
  decrypt(payload: string): Promise<string | null>;
};

const native: NativeSecureVault | undefined =
  Platform.OS === 'android'
    ? ((NativeModules as any)?.SecureVault as NativeSecureVault | undefined)
    : undefined;

export const isSecureVaultAvailable = !!native;

export function encryptSecret(plain: string): Promise<string | null> {
  if (!native) return Promise.resolve(null);
  return native.encrypt(plain).catch(() => null);
}

export function decryptSecret(payload: string): Promise<string | null> {
  if (!native) return Promise.resolve(null);
  return native.decrypt(payload).catch(() => null);
}
