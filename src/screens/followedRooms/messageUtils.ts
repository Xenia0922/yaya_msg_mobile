import { messagePayload, normalizeUrl, parseMaybeJson, pickText } from '../../utils/data';
import { toMs } from '../../utils/format';
import { t } from '../../i18n';
import { Member, RoomMessage, RoomMessageWire, WireRecord } from '../../types';
import { type RoomLiveMessage } from '../../services/pocketNim/qchat';

export type RoomMode = 'big' | 'small';

export function capText(text: string, max = 18) {
  const clean = (text || '').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function rgiftImage(g: WireRecord | null | undefined): string {
  return normalizeUrl(g?.picPath || g?.icon || g?.giftPic || g?.url || '');
}

export function parseObject(value: unknown): WireRecord {
  const parsed = parseMaybeJson(value);
  if (parsed && typeof parsed === 'object') return parsed as WireRecord;
  return {};
}

export function extraInfo(item: RoomMessageWire): WireRecord {
  return parseObject(item?.extInfo);
}

export function messageBody(item: RoomMessageWire): WireRecord {
  const body = messagePayload(item);
  return body && typeof body === 'object' ? (body as WireRecord) : {};
}

export function firstTextFrom(objects: unknown[], paths: string[]) {
  for (const obj of objects) {
    const value = pickText(obj, paths);
    if (value) return value;
  }
  return '';
}

export function deepFindText(value: unknown, keys: string[], depth = 0): string {
  if (!value || depth > 5) return '';
  if (typeof value === 'string') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindText(item, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = record[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct);
  }
  for (const child of Object.values(record)) {
    const found = deepFindText(child, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

const PRIORITY_TIME_KEYS = [
  'msgTime',
  'messageTime',
  'ctime',
  'time',
  'lastMsgTime',
  'lastTime',
  'sendTime',
  'createTime',
  'timestamp',
  'updateTime',
  'msgDate',
  'sendDate',
  'createDate',
  'updateDate',
  'dateTime',
  'msgTimestamp',
  'serverTime',
  'clientTime',
  'msgCreateTime',
  'publishTime',
  'lastUpdateTime',
] as const;

const MIN_VALID_EPOCH_MS = 946684800000;

function pickPositiveTimeFromRecord(rec: WireRecord | null | undefined): number {
  if (!rec || typeof rec !== 'object') return 0;
  for (const key of PRIORITY_TIME_KEYS) {
    const value = rec[key];
    if (
      value === undefined ||
      value === null ||
      String(value).trim() === '' ||
      Number(value) === 0
    ) {
      continue;
    }
    const ms = toMs(value);
    if (ms > 0) return ms;
  }
  for (const [key, value] of Object.entries(rec)) {
    if (!/(time|date|ctime|mtime|ts)$/i.test(key)) continue;
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const ms = toMs(value);
    if (ms >= MIN_VALID_EPOCH_MS) return ms;
  }
  return 0;
}

export function getMessageTime(item: unknown): number {
  if (!item || typeof item !== 'object') return 0;
  const msg = item as WireRecord;
  const direct = pickPositiveTimeFromRecord(msg);
  if (direct > 0) return direct;

  const nestedCandidates = [
    parseObject(msg.extInfo),
    msg.lastMessage,
    msg.lastMsg,
    msg.message,
    msg.msg,
    msg.body,
    msg.bodys,
  ];
  for (const candidate of nestedCandidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const nestedTime = pickPositiveTimeFromRecord(candidate as WireRecord);
    if (nestedTime > 0) return nestedTime;
  }
  return 0;
}

export function getNextTime(res: unknown, list: unknown[]): number {
  const cursor = pickText(res, [
    'content.nextTime',
    'content.data.nextTime',
    'data.nextTime',
    'content.next',
    'data.next',
    'nextTime',
    'next',
    'lastTime',
    'content.lastTime',
    'data.lastTime',
  ]);
  if (cursor !== '') {
    const direct = Number(cursor);

    if (Number.isFinite(direct)) return Math.max(0, direct);
  }

  const times = (Array.isArray(list) ? list : [])
    .map((item) => getMessageTime(item))
    .filter((time) => Number.isFinite(time) && time > 0);
  return times.length ? Math.min(...times) : 0;
}

const __msgDiagTag = 'INIT';
export function diagnoseUndefined(list: unknown[], tag: string) {
  if (!Array.isArray(list)) return;
  const bad = list.map((it, i) => (it == null ? i : -1)).filter((i) => i >= 0);
  if (bad.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[msgDiag:${tag}] 检出 ${bad.length} 个 null/undefined 元素，下标=[${bad.slice(0, 20).join(',')}]`,
      {
        rawSample: list.slice(0, 5),
        stack: new Error().stack,
      },
    );
  }
}

export function sortMessagesNewestFirst<T>(list: T[]): T[] {
  return list.slice().sort((a, b) => getMessageTime(b) - getMessageTime(a));
}

export function qchatToRoomMessage(msg: RoomLiveMessage): RoomMessageWire {
  const user = (
    msg.ext?.user && typeof msg.ext.user === 'object' ? msg.ext.user : {}
  ) as WireRecord;
  const nickName = String(user.nickName || user.nickname || msg.fromNick || '');
  return {
    uuid: msg.uuid,
    msgId: msg.uuid,
    msgTime: msg.time,
    time: msg.time,
    msgType: msg.messageType,

    bodys: {
      ...msg.attachment,
      text: msg.text,
      messageType: msg.messageType,
      user: {
        userId: Number(user.userId || 0),
        nickName,
        avatar: String(user.avatar || ''),
        roleId: Number(user.roleId || 0),
      },
    },
    extInfo: msg.ext,
    fromUserId: Number(user.userId || 0),
    senderUserId: Number(user.userId || 0),
    senderName: nickName,
    nickName,
    userAvatar: String(user.avatar || ''),
    channelId: msg.channelId,
    serverId: msg.serverId,

    __live: true,
  };
}

export function findLastMessage(
  messages: RoomMessageWire[],
  member?: Member,
): RoomMessageWire | null {
  if (!member) return null;
  const bigId = String(member.channelId || '');
  const ykid = String(member.yklzId || '');

  if (bigId) {
    const exact = messages.find((msg) => String(msg.channelId || '') === bigId);
    if (exact) return exact;
  }

  return (
    messages.find(
      (msg) =>
        String(msg.userId || msg.ownerId || '') === String(member.id || '') &&
        (!ykid || ykid === '0' || String(msg.channelId || '') !== ykid),
    ) || null
  );
}

export function findSmallLastMessage(
  messages: RoomMessageWire[],
  member?: Member,
): RoomMessageWire | null {
  if (!member) return null;
  const ykid = String(member.yklzId || '');
  if (!ykid || ykid === '0' || ykid === 'undefined') return null;
  return messages.find((msg) => String(msg.channelId || '') === ykid) || null;
}

export function roomChannelId(member: Member, mode: RoomMode) {
  return String(mode === 'small' ? member.yklzId || '' : member.channelId || '');
}

export function roomLabel(member: Member, mode: RoomMode) {
  return mode === 'small'
    ? t('小房间 {id}', { id: member.yklzId || t('未配置') })
    : t('大房间 {id}', { id: member.channelId || t('未配置') });
}

export type { RoomMessage };
