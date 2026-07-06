import {
  normalizeSong, normalizeArtist, normalizeGroup,
  similarity,
} from './normalize';

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
}

interface MatchResult {
  entry: LyricEntry;
  tier: number; // 1-6
  score: number;
}

const manualCache = new Map<string, string>(); // songName → filePath

export function setManualMatch(songName: string, filePath: string) {
  manualCache.set(songName, filePath);
}

export class LyricsMatcher {
  private entries: LyricEntry[];

  constructor(entries: LyricEntry[]) {
    this.entries = entries;
  }

  match(req: MatchRequest): MatchResult | null {
    const reqSong = normalizeSong(req.song);
    const reqArtist = req.artist ? normalizeArtist(req.artist) : null;
    const reqGroup = req.group ? normalizeGroup(req.group) : null;

    // Tier 1: manual cache
    const cached = manualCache.get(req.song);
    if (cached) {
      const entry = this.entries.find((e) => e.filePath === cached);
      if (entry) return { entry, tier: 1, score: 1 };
    }

    // Tier 2: strict exact (song + artist + group)
    if (reqArtist && reqGroup) {
      const hit = this.entries.find((e) =>
        e.normalized.song.strict === reqSong.strict &&
        e.normalized.artist.strict === reqArtist.strict &&
        e.normalized.group.loose === reqGroup.loose
      );
      if (hit) return { entry: hit, tier: 2, score: 1 };
    }

    // Tier 3: medium exact (song + group)
    if (reqGroup) {
      const hit = this.entries.find((e) =>
        e.normalized.song.medium === reqSong.medium &&
        e.normalized.group.loose === reqGroup.loose
      );
      if (hit) return { entry: hit, tier: 3, score: 1 };
    }

    // Tier 4: medium exact (song + artist)
    if (reqArtist) {
      const hit = this.entries.find((e) =>
        e.normalized.song.medium === reqSong.medium &&
        e.normalized.artist.medium === reqArtist.medium
      );
      if (hit) return { entry: hit, tier: 4, score: 1 };
    }

    // Tier 5: loose exact song + artist similarity sort
    if (reqArtist) {
      const candidates = this.entries.filter((e) =>
        e.normalized.song.loose === reqSong.loose
      );
      if (candidates.length > 0) {
        const best = candidates
          .map((e) => ({ entry: e, sim: similarity(reqArtist!.loose, e.normalized.artist.loose) }))
          .sort((a, b) => b.sim - a.sim)[0];
        return { entry: best.entry, tier: 5, score: best.sim };
      }
    }

    // Tier 6: fuzzy (loose song similarity > 0.9)
    const fuzzy = this.entries
      .map((e) => ({ entry: e, sim: similarity(reqSong.loose, e.normalized.song.loose) }))
      .filter((f) => f.sim > 0.9)
      .sort((a, b) => b.sim - a.sim);
    if (fuzzy.length > 0) return { entry: fuzzy[0].entry, tier: 6, score: fuzzy[0].sim };

    return null;
  }
}
