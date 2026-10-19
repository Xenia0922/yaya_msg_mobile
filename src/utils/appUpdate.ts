/**
 * 应用内更新的 APK 资产解析。
 *
 * GitHub Release 的资产命名约定（见 scripts/build-apk.js 的产物拷贝逻辑）：
 *   yaya-msg-mobile-<tag>-v8a.apk / -v7a.apk / -x64.apk / -universal.apk
 * tag 形如 v2.7.6（含 v）。
 *
 * 分包 m 与 universal 体积差 ~2.5 倍，所以优先下对应 ABI 的分包，404 时再回退 universal。
 */

const REPO = 'Xenia0922/yaya_msg_mobile';

export type AbiAssetTag = 'v8a' | 'v7a' | 'x64' | 'universal';

export function resolveAbiAssetTag(abi: string): AbiAssetTag {
  const a = String(abi || '').toLowerCase();
  if (a.includes('arm64')) return 'v8a';
  if (a.includes('x86_64') || a.includes('x86-64') || a.includes('x64')) return 'x64';
  if (a.includes('armeabi') || a.includes('armv7')) return 'v7a';
  return 'universal';
}

export interface ApkAsset {
  /** 对应设备 ABI 的分包直链 */
  primaryUrl: string;
  /** 分包缺失时的全量包直链 */
  fallbackUrl: string;
  /** GitHub Release 资产名（也是自建源 packages 里的匹配名） */
  assetName: string;
  /** 落地文件名（带版本，避免旧包被复用） */
  fileName: string;
  /** 用于文案展示的分包标识 */
  abiTag: AbiAssetTag;
}

/** 自建下载源：010Push 站（CF 托管，境内可达），包列表按文件名匹配 */
const SELF_PACKAGES_URL = 'https://gnz48.tech/api/packages';

/**
 * 在自建源里找同名安装包。境内直连 GitHub 的下载链路经常不通
 * （api.github.com 能通、github.com→objects.githubusercontent.com 不通），
 * 所以自建源有货就优先走它，GitHub 退居兜底。
 */
export async function findSelfHostedUrl(assetName: string): Promise<string | null> {
  try {
    const res = await fetch(SELF_PACKAGES_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const data: any = await res.json();
    const list = Array.isArray(data?.packages) ? data.packages : [];
    // 同名可能有多条（重复上传）：取最新一条
    const hits = list
      .filter((p: any) => String(p?.name || '') === assetName)
      .sort((x: any, y: any) => String(y?.uploadedAt || '').localeCompare(String(x?.uploadedAt || '')));
    const hit = hits[0];
    return hit?.id ? `https://gnz48.tech/api/pkg/${hit.id}` : null;
  } catch {
    return null;
  }
}

/** 由 release tag（如 v2.7.6）+ 设备 ABI（如 arm64-v8a）构造下载地址 */
export function buildApkAsset(tag: string, abi: string): ApkAsset {
  const t = String(tag || '').replace(/^\/+/, '').trim();
  const abiTag = resolveAbiAssetTag(abi);
  const base = `https://github.com/${REPO}/releases/download/${t}`;
  const urlOf = (suffix: AbiAssetTag) => `${base}/yaya-msg-mobile-${t}-${suffix}.apk`;
  return {
    primaryUrl: urlOf(abiTag),
    fallbackUrl: urlOf('universal'),
    assetName: `yaya-msg-mobile-${t}-${abiTag}.apk`,
    fileName: `update-${t.replace(/^v/i, '')}-${abiTag}.apk`,
    abiTag,
  };
}
