export interface UpdateCache {
  checkedDate: string;
  checkedAt: number;
  latestTag: string;
  latestUrl: string;
  releaseNotes: string;
}

export function localTodayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseUpdateCache(raw: string | null): UpdateCache {
  const empty: UpdateCache = {
    checkedDate: '',
    checkedAt: 0,
    latestTag: '',
    latestUrl: '',
    releaseNotes: '',
  };
  if (!raw) return empty;
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return {
        checkedDate: String(parsed?.checkedDate || ''),
        checkedAt: Number(parsed?.checkedAt) || 0,
        latestTag: String(parsed?.latestTag || ''),
        latestUrl: String(parsed?.latestUrl || ''),
        releaseNotes: String(parsed?.releaseNotes || ''),
      };
    } catch {
      return empty;
    }
  }
  const legacyTs = Number(raw) || 0;
  return { ...empty, checkedAt: legacyTs };
}

function parseVersion(v: string): number[] {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((seg) => parseInt(seg, 10))
    .filter((n) => !Number.isNaN(n));
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export function formatReleaseNotesForDisplay(notes: string): string {
  const trimmed = String(notes || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/^#+\s+[^\n]*(?:\r?\n)+/, '').trim();
}

export function shouldPromptDailyUpdate({
  hasUpdate,
  force,
  promptedDate,
  today,
}: {
  hasUpdate: boolean;
  force: boolean;
  promptedDate: string;
  today: string;
}): boolean {
  return !force && hasUpdate && promptedDate !== today;
}

export function evaluateUpdateFromCache(
  cached: UpdateCache,
  currentVersion: string,
  promptedDate: string,
  today: string,
  defaultUrl: string,
) {
  const hasUpdate = !!cached.latestTag && isNewerVersion(cached.latestTag, currentVersion);
  return {
    hasUpdate,
    latestVersion: hasUpdate ? cached.latestTag : '',
    latestUrl: hasUpdate ? cached.latestUrl || defaultUrl : '',
    releaseNotes: hasUpdate ? cached.releaseNotes : '',
    pendingDailyPrompt: shouldPromptDailyUpdate({ hasUpdate, force: false, promptedDate, today }),
  };
}
