import { normalizeSong, normalizeArtist, normalizeGroup, similarity } from './normalize';

export interface LyricEntry {
  id: string;
  songName: string;
  artist: string;
  group: string;
  filePath: string;
  normalized: {
    song: { strict: string; medium: string; loose: string };
    artist: { strict: string; medium: string; loose: string };
    group: { strict: string; medium: string; loose: string };
  };
}

interface MatchRequest {
  song: string;
  artist?: string;
  group?: string;

  album?: string;
}

interface MatchResult {
  entry: LyricEntry;
  tier: number;
  score: number;
}

const manualCache = new Map<string, string>();

export function setManualMatch(songName: string, filePath: string) {
  manualCache.set(songName, filePath);
}

export class LyricsMatcher {
  private entries: LyricEntry[];

  constructor(entries: LyricEntry[]) {
    this.entries = entries;
  }

  private pickVersion(list: LyricEntry[], album?: string): LyricEntry {
    if (list.length <= 1 || !album) return list[0];
    const alb = normalizeSong(album).medium;
    if (!alb) return list[0];
    const score = (e: LyricEntry) => {
      const folder = normalizeSong(String(e.filePath).split('/').slice(0, -1).join(' ')).medium;
      if (!folder) return 0;
      if (folder.includes(alb) || alb.includes(folder)) return 3;
      const tokens = alb.split(/\s+/).filter((x) => x.length > 1);
      return tokens.some((t) => folder.includes(t)) ? 2 : 0;
    };
    let best = list[0];
    let bestScore = -1;
    for (const e of list) {
      const sc = score(e);
      if (sc > bestScore) {
        bestScore = sc;
        best = e;
      }
    }
    return best;
  }

  match(req: MatchRequest): MatchResult | null {
    const reqSong = normalizeSong(req.song);
    const reqArtist = req.artist ? normalizeArtist(req.artist) : null;
    const reqGroup = req.group ? normalizeGroup(req.group) : null;

    const cached = manualCache.get(req.song);
    if (cached) {
      const entry = this.entries.find((e) => e.filePath === cached);
      if (entry) return { entry, tier: 1, score: 1 };
    }

    if (reqArtist && reqGroup) {
      const hits = this.entries.filter(
        (e) =>
          e.normalized.song.strict === reqSong.strict &&
          e.normalized.artist.strict === reqArtist.strict &&
          e.normalized.group.loose === reqGroup.loose,
      );
      if (hits.length) return { entry: this.pickVersion(hits, req.album), tier: 2, score: 1 };
    }

    if (reqGroup) {
      const hits = this.entries.filter(
        (e) =>
          e.normalized.song.medium === reqSong.medium &&
          e.normalized.group.loose === reqGroup.loose,
      );
      if (hits.length) return { entry: this.pickVersion(hits, req.album), tier: 3, score: 1 };
    }

    if (reqArtist) {
      const hit = this.entries.find(
        (e) =>
          e.normalized.song.medium === reqSong.medium &&
          e.normalized.artist.medium === reqArtist.medium,
      );
      if (hit) return { entry: hit, tier: 4, score: 1 };
    }

    if (reqArtist) {
      const candidates = this.entries.filter((e) => e.normalized.song.loose === reqSong.loose);
      if (candidates.length > 0) {
        const best = candidates
          .map((e) => ({ entry: e, sim: similarity(reqArtist!.loose, e.normalized.artist.loose) }))
          .sort((a, b) => b.sim - a.sim)[0];
        return { entry: best.entry, tier: 5, score: best.sim };
      }
    }

    const fuzzy = this.entries
      .map((e) => ({ entry: e, sim: similarity(reqSong.loose, e.normalized.song.loose) }))
      .filter((f) => f.sim > 0.9)
      .sort((a, b) => b.sim - a.sim);
    if (fuzzy.length > 0) return { entry: fuzzy[0].entry, tier: 6, score: fuzzy[0].sim };

    return null;
  }
}
