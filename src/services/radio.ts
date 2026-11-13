import pocketApi from '../api/pocket48';
import { resolveMemberRooms } from './roomMapCache';
import { pickText } from '../utils/data';
import { useMemberStore } from '../store';
import type { Member } from '../types';

/** 上麦/电台流是否 rtmp（react-native-video 不支持，需原生 LiveExoView） */
export function isRtmpRadioUrl(url: string): boolean {
  return String(url || '').toLowerCase().startsWith('rtmp://');
}

/**
 * 拉取成员电台/上麦流地址（房间映射缺失时自动补齐）。
 * 从 RoomRadioScreen 内的 fetchRadioUrl 抽出，供「房间内直接播放」复用。
 * 返回 null 表示接口成功但当前未开麦；抛 NO_CHANNEL 表示缺少房间映射。
 */
export async function fetchMemberRadioUrl(member: Member, mode: 'big' | 'small' = 'big'): Promise<string | null> {
  // 语义保持 2.7.3：小房间=member.yklzId，大房间=member.channelId
  let channelId = mode === 'small' ? (member.yklzId || member.channelId) : member.channelId;
  let serverId = member.serverId;
  const needResolve = !channelId || channelId === '0' || channelId === 'undefined'
    || (mode === 'small' && (!member.yklzId || member.yklzId === '0' || member.yklzId === 'undefined'));
  if (needResolve) {
    const room = await resolveMemberRooms(String(member.id || ''), {
      name: member.ownerName,
      knownChannelId: member.channelId,
      knownYklzId: member.yklzId,
      knownServerId: member.serverId,
    });
    channelId = mode === 'small' ? (room.yklzId || room.channelId) : room.channelId;
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
  const url = pickText(res, ['content.streamUrl', 'content.url', 'content.streamPath', 'content.playUrl', 'data.streamUrl', 'data.url', 'streamUrl', 'url']);
  return url || null;
}
