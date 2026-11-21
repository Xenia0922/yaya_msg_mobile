import pocketApi from '../api/pocket48';
import { resolveMemberRooms } from './roomMapCache';
import { pickText } from '../utils/data';
import { useMemberStore } from '../store';
import type { Member } from '../types';
import { isRtmpUrl } from '../player/resolve/streamResolver';

export function isRtmpRadioUrl(url: string): boolean {
  return isRtmpUrl(url);
}

export async function fetchMemberRadioUrl(
  member: Member,
  mode: 'big' | 'small' = 'big',
): Promise<string | null> {
  let channelId = mode === 'small' ? member.yklzId || member.channelId : member.channelId;
  let serverId = member.serverId;
  const needResolve =
    !channelId ||
    channelId === '0' ||
    channelId === 'undefined' ||
    (mode === 'small' &&
      (!member.yklzId || member.yklzId === '0' || member.yklzId === 'undefined'));
  if (needResolve) {
    const room = await resolveMemberRooms(String(member.id || ''), {
      name: member.ownerName,
      knownChannelId: member.channelId,
      knownYklzId: member.yklzId,
      knownServerId: member.serverId,
    });
    channelId = mode === 'small' ? room.yklzId || room.channelId : room.channelId;
    serverId = room.serverId || member.serverId;
    if (channelId) {
      useMemberStore.getState().patchMemberByUserId(String(member.id || ''), {
        channelId: room.channelId || member.channelId,
        yklzId: room.yklzId || member.yklzId,
        serverId,
      });
    }
  }
  if (!channelId || channelId === '0' || channelId === 'undefined') {
    const err: any = new Error('NO_CHANNEL');
    err.code = 'NO_CHANNEL';
    throw err;
  }
  const res = await pocketApi.operateRoomVoice({ channelId, serverId });
  if (res?.status && Number(res.status) !== 200) return null;
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
