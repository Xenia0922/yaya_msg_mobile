import pocketApi from '../api/pocket48';
import { normalizeLiveRank } from '../screens/followedRooms/roomDomain';
import { parseDurationSeconds } from './duration';
import { formatDuration, formatTimestamp, toMs } from './format';

export interface LiveEndSummary {
  title: string;
  member: string;
  startTime: string;
  duration: string;
  top: { name: string; value: string }[];
}

export async function fetchLiveEndSummary(opts: {
  liveId: string;
  fallbackTitle?: string;
  fallbackMember?: string;
  startTime?: number | string;
}): Promise<LiveEndSummary> {
  const [resultRes, rankRes] = await Promise.all([
    pocketApi.getLiveResult(opts.liveId).catch(() => null),
    pocketApi.getLiveRank(opts.liveId).catch(() => null),
  ]);
  const root = (resultRes?.content || resultRes?.data || resultRes || {}) as Record<string, any>;
  const result = (root.liveResult || root.result || root) as Record<string, any>;
  const top = normalizeLiveRank(rankRes)
    .slice(0, 3)
    .map((row) => ({ name: row.name, value: String(row.value || '') }));

  const title = String(result.title || result.liveTitle || opts.fallbackTitle || '');
  const member = String(
    result.memberName ||
      result.userName ||
      result.nickname ||
      result.ownerName ||
      opts.fallbackMember ||
      '',
  );
  const startRaw = result.startTime || result.ctime || opts.startTime || 0;
  const startTime = startRaw ? formatTimestamp(startRaw).slice(0, 16) : '';
  const durSec =
    parseDurationSeconds(result.duration ?? result.liveDuration ?? result.playTime ?? 0) ||
    (() => {
      const st = toMs(startRaw);
      const et = toMs(result.endTime || 0);
      return st > 0 && et > st ? Math.round((et - st) / 1000) : 0;
    })();
  return {
    title,
    member,
    startTime,
    duration: durSec > 0 ? formatDuration(durSec) : '',
    top,
  };
}
