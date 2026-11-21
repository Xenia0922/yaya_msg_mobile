const REPO = 'Xenia0922/yaya_msg_mobile';

import { parseMaybeJson } from '../utils/data';
import { fetchWithTimeout } from './network';

export type AbiAssetTag = 'v8a' | 'v7a' | 'x64' | 'universal';

export function resolveAbiAssetTag(abi: string): AbiAssetTag {
  const a = String(abi || '').toLowerCase();
  if (a.includes('arm64')) return 'v8a';
  if (a.includes('x86_64') || a.includes('x86-64') || a.includes('x64')) return 'x64';
  if (a.includes('armeabi') || a.includes('armv7')) return 'v7a';
  return 'universal';
}

export interface ApkAsset {
  primaryUrl: string;

  fallbackUrl: string;

  assetName: string;

  fileName: string;

  abiTag: AbiAssetTag;
}

const SELF_PACKAGES_URL = 'https://gnz48.tech/api/packages';

export async function findSelfHostedUrl(assetName: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      SELF_PACKAGES_URL,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
      10000,
    );
    if (!res.ok) return null;
    const data: any = parseMaybeJson(await res.text());
    const list = Array.isArray(data?.packages) ? data.packages : [];

    const hits = list
      .filter((p: any) => String(p?.name || '') === assetName)
      .sort((x: any, y: any) =>
        String(y?.uploadedAt || '').localeCompare(String(x?.uploadedAt || '')),
      );
    const hit = hits[0];
    return hit?.id ? `https://gnz48.tech/api/pkg/${hit.id}` : null;
  } catch {
    return null;
  }
}

export function buildApkAsset(
  tag: string,
  abi: string,
  flavor: 'public' | 'plus' = 'public',
): ApkAsset {
  const t = String(tag || '')
    .replace(/^\/+/, '')
    .trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(t)) {
    throw new Error(`非法的版本标签：${t}`);
  }
  const abiTag = resolveAbiAssetTag(abi);
  const base = `https://github.com/${REPO}/releases/download/${t}`;
  const prefix = flavor === 'plus' ? 'yaya-msg-mobile-plus' : 'yaya-msg-mobile';
  const urlOf = (suffix: AbiAssetTag) => `${base}/${prefix}-${t}-${suffix}.apk`;
  return {
    primaryUrl: urlOf(abiTag),
    fallbackUrl: urlOf('universal'),
    assetName: `${prefix}-${t}-${abiTag}.apk`,
    fileName: `update-${t.replace(/^v/i, '')}-${abiTag}${flavor === 'plus' ? '-plus' : ''}.apk`,
    abiTag,
  };
}
