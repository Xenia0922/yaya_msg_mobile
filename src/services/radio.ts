import pocketApi from '../api/pocket48';
import { resolveMemberRooms } from './roomMapCache';
import { pickText } from '../utils/data';
import { useMemberStore } from '../store';
import type { Member } from '../types';
import { isRtmpUrl } from '../player/resolve/streamResolver';

export function isRtmpRadioUrl(url: string): boolean {
  return isRtmpUrl(url);
}

export interface RadioStreamResult {
  url: string | null;
  mode: 'big' | 'small';
  channelId: string;
  serverId: string;
}

function validChannelId(value: unknown): string {
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s) && s !== '0' ? s : '';
}

function extractStreamUrl(res: any): string | null {
  if (!res || (res?.status && Number(res.status) !== 200)) return null;
  const url = pickText(res, [
    'content.streamUrl',
    'content.url',
    'content.streamPath',
    'content.playUrl',
    'data.streamUrl',
    'data.url',
    'streamUrl',
    'url',
  ]);
  return url || null;
}

export async function fetchMemberRadioStream(
  member: Member,
  mode: 'big' | 'small' = 'big',
  opts?: { allowFallbackMode?: boolean },
): Promise<RadioStreamResult> {
  let bigId = validChannelId(member.channelId);
  let smallId = validChannelId(member.yklzId);
  let serverId = String(member.serverId || '').trim();

  const needResolve = mode === 'small' ? !smallId : !bigId;
  if (needResolve || !serverId || serverId === '0') {
    const room = await resolveMemberRooms(String(member.id || ''), {
      name: member.ownerName,
      knownChannelId: member.channelId,
      knownYklzId: member.yklzId,
      knownServerId: member.serverId,
    });
    const nextBig = validChannelId(room.channelId);
    const nextSmall = validChannelId(room.yklzId);
    if (nextBig) bigId = nextBig;
    if (nextSmall) smallId = nextSmall;
    if (room.serverId) serverId = String(room.serverId).trim();
    if (nextBig || nextSmall || room.serverId) {
      useMemberStore.getState().patchMemberByUserId(String(member.id || ''), {
        channelId: bigId || member.channelId,
        yklzId: smallId || member.yklzId,
        serverId: serverId || member.serverId,
      });
    }
  }

  const primaryChannelId = mode === 'small' ? smallId : bigId;
  const altMode: 'big' | 'small' = mode === 'small' ? 'big' : 'small';
  const altChannelId = altMode === 'small' ? smallId : bigId;

  if (!primaryChannelId) {
    if (opts?.allowFallbackMode && altChannelId) {
      const altRes = await pocketApi.operateRoomVoice({ channelId: altChannelId, serverId });
      return {
        url: extractStreamUrl(altRes),
        mode: altMode,
        channelId: altChannelId,
        serverId,
      };
    }
    const err: any = new Error('NO_CHANNEL');
    err.code = 'NO_CHANNEL';
    throw err;
  }

  const res = await pocketApi.operateRoomVoice({ channelId: primaryChannelId, serverId });
  const primaryUrl = extractStreamUrl(res);
  if (primaryUrl || !opts?.allowFallbackMode || !altChannelId) {
    return {
      url: primaryUrl,
      mode,
      channelId: primaryChannelId,
      serverId,
    };
  }

  const altRes = await pocketApi.operateRoomVoice({ channelId: altChannelId, serverId });
  const altUrl = extractStreamUrl(altRes);
  return {
    url: altUrl,
    mode: altUrl ? altMode : mode,
    channelId: altUrl ? altChannelId : primaryChannelId,
    serverId,
  };
}

export async function fetchMemberRadioUrl(
  member: Member,
  mode: 'big' | 'small' = 'big',
): Promise<string | null> {
  const res = await fetchMemberRadioStream(member, mode);
  return res.url;
}
