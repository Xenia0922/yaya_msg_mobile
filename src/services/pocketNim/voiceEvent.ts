import type { RoomLiveMessage } from './qchat';

export type VoiceEventKind = 'room' | 'member';

export interface VoiceEventUser {
  userId: string;
  nickname: string;
  avatar: string;
  micState: boolean;
}

export interface VoiceEvent {
  kind: VoiceEventKind;
  serverId: string;
  channelId: string;

  active?: boolean;

  operateType?: string;
  streamUrl?: string;
  users: VoiceEventUser[];
}

function pickUser(raw: any): VoiceEventUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const userId = String(raw.userId || raw.user_id || raw.id || '').trim();
  if (!userId) return null;
  return {
    userId,
    nickname: String(raw.nickname || raw.nickName || raw.name || ''),
    avatar: String(raw.avatar || raw.pfUrl || ''),
    micState: raw.micState !== false && raw.voiceStatus !== false,
  };
}

export function parseVoiceEvent(message: RoomLiveMessage): VoiceEvent | null {
  const messageType = String(message.messageType || message.attachment?.messageType || '');
  if (messageType !== 'TEAM_VOICE' && messageType !== 'VOICE_OPERATE') return null;

  const attachment = (message.attachment || {}) as Record<string, any>;
  const box = (attachment.voiceInfo || attachment.audioChatInfo || attachment) as Record<
    string,
    any
  >;
  const serverId = String(message.serverId || '');
  const channelId = String(
    message.channelId || box.channelId || box.targetChannel?.channelId || '',
  );

  if (messageType === 'VOICE_OPERATE') {
    const operate = (attachment.operateType || box.operateType || {}) as Record<string, any>;
    const target = (operate.targetChannel || box.targetChannel || operate) as Record<string, any>;
    return {
      kind: 'room',
      serverId,
      channelId,
      active:
        target.isInVoiceChatting === true ||
        target.inVoiceChatting === true ||
        attachment.isInVoiceChatting === true,
      users: [],
    };
  }

  const rawUsers = Array.isArray(box.voiceStarInfoList)
    ? box.voiceStarInfoList
    : Array.isArray(box.voiceUserList)
      ? box.voiceUserList
      : [];
  return {
    kind: 'member',
    serverId,
    channelId,
    operateType: String(box.operateType || ''),
    streamUrl: String(box.streamUrl || ''),
    users: rawUsers.map(pickUser).filter((user): user is VoiceEventUser => !!user),
  };
}
