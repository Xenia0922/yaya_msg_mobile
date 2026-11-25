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

function indexPush(map: Map<string, LyricEntry[]>, key: string, entry: LyricEntry) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

export class LyricsMatcher {
  private entries: LyricEntry[];
  private byPath = new Map<string, LyricEntry>();
  private bySongStrict = new Map<string, LyricEntry[]>();
  private bySongMedium = new Map<string, LyricEntry[]>();
  private bySongLoose = new Map<string, LyricEntry[]>();

  constructor(entries: LyricEntry[]) {
    this.entries = entries;
    for (const e of entries) {
      this.byPath.set(e.filePath, e);
      indexPush(this.bySongStrict, e.normalized.song.strict, e);
      indexPush(this.bySongMedium, e.normalized.song.medium, e);
      indexPush(this.bySongLoose, e.normalized.song.loose, e);
    }
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
      const entry = this.byPath.get(cached);
      if (entry) return { entry, tier: 1, score: 1 };
    }

    if (reqArtist && reqGroup) {
      const strictHits = this.bySongStrict.get(reqSong.strict) || [];
      const hits = strictHits.filter(
        (e) =>
          e.normalized.artist.strict === reqArtist.strict &&
          e.normalized.group.loose === reqGroup.loose,
      );
      if (hits.length) return { entry: this.pickVersion(hits, req.album), tier: 2, score: 1 };
    }

    const mediumHits = this.bySongMedium.get(reqSong.medium) || [];

    if (reqGroup) {
      const hits = mediumHits.filter((e) => e.normalized.group.loose === reqGroup.loose);
      if (hits.length) return { entry: this.pickVersion(hits, req.album), tier: 3, score: 1 };
    }

    if (reqArtist) {
      const hit = mediumHits.find((e) => e.normalized.artist.medium === reqArtist.medium);
      if (hit) return { entry: hit, tier: 4, score: 1 };
    }

    if (reqArtist) {
      const candidates = this.bySongLoose.get(reqSong.loose) || [];
      if (candidates.length > 0) {
        const best = candidates
          .map((e) => ({ entry: e, sim: similarity(reqArtist.loose, e.normalized.artist.loose) }))
          .sort((a, b) => b.sim - a.sim)[0];
        return { entry: best.entry, tier: 5, score: best.sim };
      }
    }

    let bestFuzzy: { entry: LyricEntry; sim: number } | null = null;
    for (const e of this.entries) {
      const sim = similarity(reqSong.loose, e.normalized.song.loose);
      if (sim > 0.9 && (!bestFuzzy || sim > bestFuzzy.sim)) {
        bestFuzzy = { entry: e, sim };
      }
    }
    if (bestFuzzy) return { entry: bestFuzzy.entry, tier: 6, score: bestFuzzy.sim };

    return null;
  }
}
