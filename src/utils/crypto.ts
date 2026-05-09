import CryptoJS from 'crypto-js';

export function randomHex(length: number): string {
  const chars = 'abcdef0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateDeviceId(): string {
  const template = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
  let result = '';
  for (let i = 0; i < template.length; i++) {
    const c = template.charAt(i);
    if (c === 'x') {
      result += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    } else {
      result += c;
    }
  }
  return result;
}

export function generateNonce(): string {
  return `${Date.now()}-${randomHex(5)}`;
}

export function generateTimestamp(): string {
  return String(Date.now());
}

export function md5Hash(text: string): string {
  return CryptoJS.MD5(text).toString();
}

export function signPocketRequest(params: Record<string, any>): string {
  const keys = Object.keys(params).sort();
  const kv = keys.map((k) => `${k}=${params[k]}`).join('&');
  return md5Hash(kv);
}

export function createPocketToken(token: string): string {
  return md5Hash(token + 'zXh&H7$Kp@M9');
}
