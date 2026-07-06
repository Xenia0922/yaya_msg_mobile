import { LyricsMatcher, LyricEntry } from './lyricsMatcher';
import { normalizeSong, normalizeArtist, normalizeGroup } from './normalize';

interface RawIndexEntry {
  path: string;
  group: string;
  folder: string;
  file: string;
  songTitle: string;
}

export function buildLyricEntries(raw: RawIndexEntry[]): LyricEntry[] {
  const dedup = new Map<string, LyricEntry>();
  for (const item of raw) {
    if (!item.songTitle || !item.path) continue;
    const id = `${item.group}-${item.songTitle}`;
    if (dedup.has(id)) continue;
    const ns = normalizeSong(item.songTitle);
    const na = normalizeArtist(item.group);
    const ng = normalizeGroup(item.group);
    dedup.set(id, {
      id,
      songName: item.songTitle,
      artist: item.group,
      group: item.group,
      filePath: item.path,
      normalized: {
        song: { strict: ns.strict, medium: ns.medium, loose: ns.loose },
        artist: { strict: na.strict, medium: na.medium, loose: na.loose },
        group: { strict: ng.strict, medium: ng.medium, loose: ng.loose },
      },
    });
  }
  return [...dedup.values()];
}

let cachedMatcher: { entries: LyricEntry[]; matcher: any } | null = null;

export async function getLyricsMatcher() {
  if (cachedMatcher) return cachedMatcher;
  const resp = await fetch('https://yaya-data.pages.dev/lyrics-index.json');
  const raw: RawIndexEntry[] = await resp.json();
  const entries = buildLyricEntries(raw);
  const matcher = new LyricsMatcher(entries);
  cachedMatcher = { entries, matcher };
  return cachedMatcher;
}
