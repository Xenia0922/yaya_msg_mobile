import { Member, MemberSummary, RoomMessageWire, WireRecord } from '../../types';
import { t } from '../../i18n';
import {
  extractDeletedMessageIds,
  isHiddenControlMessage,
  normalizeUrl,
  unwrapList,
  parseMaybeJson,
  pickText,
  messageText,
} from '../../utils/data';
import { type MediaType } from './mediaUtils';
import {
  messageBody,
  extraInfo,
  firstTextFrom,
  getMessageTime,
  diagnoseUndefined,
  sortMessagesNewestFirst,
} from './messageUtils';

export type SenderProfile = {
  id: string;
  name: string;
  avatar: string;
};

export type MessageRole = 'idol' | 'mine' | 'fan';

export function shortName(member?: Member, fallback = '') {
  const raw = member?.ownerName || fallback || t('未知成员');
  return raw.replace(/^(SNH48|GNZ48|BEJ48|CKG48|CGT48)-/, '');
}

const senderProfileCache = new WeakMap<object, SenderProfile>();
const messageKeyCache = new WeakMap<object, string>();
const messageSearchHaystackCache = new WeakMap<object, string>();

export function senderProfile(item: RoomMessageWire, _room: Member): SenderProfile {
  if (!item) return { id: '', name: t('未知用户'), avatar: '' };
  if (typeof item === 'object') {
    const cached = senderProfileCache.get(item);
    if (cached) return cached;
  }
  const body = messageBody(item);
  const extUser: WireRecord = extraInfo(item)?.user || {};

  const senderContainers = [
    extUser,
    item?.user,
    item?.sender,
    (item as any)?.fromUser,
    body?.user,
    body?.sender,
    (body as any)?.fromUser,
  ].filter((v): v is WireRecord => !!v && typeof v === 'object');
  const direct = (keys: string[]) => firstTextFrom([item, body], keys);
  const id =
    String(extUser.userId ?? extUser.id ?? '').trim() ||
    direct([
      'senderUserId',
      'senderId',
      'fromUserId',
      'fromAccount',
      'sender.userId',
      'sender.id',
      'message.senderId',
    ]) ||
    firstTextFrom(senderContainers, ['userId', 'id', 'uid', 'account']) ||
    direct(['userId', 'uid', 'account']);
  const name =
    String(extUser.nickName || extUser.nickname || '').trim() ||
    firstTextFrom(senderContainers, ['nickName', 'nickname', 'userName', 'name']) ||
    direct(['senderName', 'senderNickName', 'fromNickName', 'user.nickName', 'user.nickname']);
  const avatar =
    String(extUser.avatar || extUser.headImg || '').trim() ||
    firstTextFrom(senderContainers, ['avatar', 'headImg', 'headUrl']) ||
    direct(['senderAvatar', 'sender.avatar', 'sender.headImg', 'user.avatar', 'user.headImg']);

  const res: SenderProfile = {
    id: String(id || '').trim(),
    name: name || (id ? t('用户 {id}', { id }) : t('未知用户')),
    avatar: normalizeUrl(String(avatar || '').trim()),
  };
  if (typeof item === 'object') senderProfileCache.set(item, res);
  return res;
}

export function isIdolMessage(
  item: RoomMessageWire,
  room: Member,
  includeFans: boolean,
  sender?: SenderProfile,
) {
  if (!room) return false;
  const body = messageBody(item);
  const ext = extraInfo(item);

  const profile = sender || senderProfile(item, room);
  const ownerIds = [room.id, room.userId, room.memberId].map(String).filter(Boolean);
  if (profile.id && ownerIds.includes(String(profile.id))) return true;

  if (profile.id) return false;

  if (!includeFans) return true;
  const role = firstTextFrom(
    [item, ext, body],
    ['roleId', 'user.roleId', 'sender.roleId', 'message.roleId'],
  );
  if (role && ['2', '3', '4', 'star', 'idol'].includes(String(role).toLowerCase())) return true;
  return false;
}

export function currentUserIdFrom(res: unknown): string {
  const root = res as WireRecord | null | undefined;
  return firstTextFrom(
    [root?.content, root?.data, root],
    ['userInfo.userId', 'userInfo.id', 'user.userId', 'user.id', 'userId', 'id', 'account'],
  );
}

export function messageRole(
  item: RoomMessageWire,
  room: Member,
  includeFans: boolean,
  currentUserId: string,
  memberIds?: Set<string>,
): MessageRole {
  if (!item) return 'fan';
  const profile = senderProfile(item, room);
  if (includeFans && currentUserId && profile.id && String(profile.id) === String(currentUserId))
    return 'mine';
  if (isIdolMessage(item, room, includeFans, profile)) return 'idol';

  if (profile.id && memberIds && memberIds.has(String(profile.id))) return 'idol';
  return 'fan';
}

export function matchFollowedMember<T extends MemberSummary>(
  members: T[],
  id: string,
): T | undefined {
  const target = String(id || '').trim();
  if (!target) return undefined;
  return members.find((item) => {
    const ids = [item?.id, item?.userId, item?.memberId, item?.account].map((v) =>
      String(v ?? '').trim(),
    );
    return ids.includes(target);
  });
}

export function buildMemberIdSet(members: MemberSummary[]): Set<string> {
  const set = new Set<string>();
  (members || []).forEach((m) => {
    [m?.id, m?.userId, m?.memberId].forEach((v) => {
      const s = String(v ?? '').trim();
      if (s) set.add(s);
    });
  });
  return set;
}

export function userCardFromUserRes(res: unknown) {
  const root = (res || {}) as WireRecord;
  const content = (root?.content || root?.data?.content || root?.data || root || {}) as WireRecord;
  const userInfo = (content?.userInfo ||
    content?.user ||
    content?.profile ||
    content ||
    {}) as WireRecord;
  const base = (userInfo?.baseUserInfo || userInfo?.baseInfo || userInfo || {}) as WireRecord;
  const star = (content?.starInfo || content?.memberInfo || userInfo?.starInfo || {}) as WireRecord;
  const objs = [base, userInfo, star, content];
  const pick = (keys: string[]) => firstTextFrom(objs, keys);

  const relationValue = String(
    pick([
      'relation',
      'relationType',
      'followStatus',
      'friendStatus',
      'isFollow',
      'followed',
      'isFriend',
      'relationship',
    ]) || '',
  )
    .trim()
    .toLowerCase();
  const mutual = ['mutual', 'both', 'friend', 'friends', '2', '3'].includes(relationValue);
  const following = mutual || ['true', 'followed', 'following', '1'].includes(relationValue);
  return {
    name: pick([
      'nickName',
      'nickname',
      'userName',
      'name',
      'starName',
      'realNickName',
      'baseUserInfo.nickName',
    ]),
    avatar: normalizeUrl(
      pick(['avatar', 'avatarUrl', 'faceImage', 'headImg', 'headUrl', 'starAvatar']),
    ),
    level: pick(['level', 'userLevel', 'grade', 'vipLevel', 'userLevelName']),
    signature: pick(['signature', 'sign', 'intro', 'description', 'userSignature']),
    team: pick(['starTeamName', 'teamName', 'team']),
    period: pick(['periodName', 'period']),
    isStar:
      !!(star && (star.starName || star.starId)) || base?.isStar === true || base?.star === true,
    following,
    mutual,
  };
}

export function collectRoomMessageIds(item: RoomMessageWire): string[] {
  if (!item || typeof item !== 'object') return [];
  const rawIds = [
    item.msgIdClient,
    item.clientMsgId,
    item.uuid,
    item.msgUuid,
    item.msgId,
    item.messageId,
    item.id,
    item.msgIdServer,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawIds) {
    if (raw === undefined || raw === null) continue;
    const val = String(raw).trim();
    if (!val || seen.has(val)) continue;
    seen.add(val);
    out.push(val);
  }
  return out;
}

export function messageKey(item: RoomMessageWire) {
  if (!item) return `empty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (typeof item === 'object') {
    const cached = messageKeyCache.get(item);
    if (cached) return cached;
  }
  const direct =
    item.id ||
    item.msgId ||
    item.messageId ||
    item.msgIdClient ||
    item.clientMsgId ||
    item.uuid ||
    item.msgUuid ||
    item.msgIdServer;
  let computed: string;
  if (direct) {
    computed = String(direct);
  } else {
    const profile = senderProfile(item, {} as Member);
    const body = messageBody(item);
    const text = firstTextFrom(
      [body, item],
      ['text', 'message', 'msgContent', 'content', 'bodys', 'body'],
    );
    const media = firstTextFrom(
      [body, item],
      ['url', 'fileUrl', 'pictureUrl', 'coverUrl', 'liveId'],
    );
    computed = String(
      `${getMessageTime(item)}-${profile.id || profile.name || ''}-${text || media || JSON.stringify(body).slice(0, 120)}`,
    );
  }
  if (typeof item === 'object') messageKeyCache.set(item, computed);
  return computed;
}

export function matchesDeletedMessageId(
  item: RoomMessageWire,
  deletedIds: ReadonlySet<string>,
): boolean {
  if (!item || !deletedIds.size) return false;
  if (deletedIds.has(messageKey(item))) return true;
  return collectRoomMessageIds(item).some((id) => deletedIds.has(id));
}

export function filterVisibleRoomMessages<T extends RoomMessageWire>(
  list: T[],
  externalDeletedIds?: ReadonlySet<string>,
): { visible: T[]; deletedIdsFound: string[] } {
  const deletedIdsFound: string[] = [];
  const foundSet = new Set<string>();
  const combined = new Set<string>(externalDeletedIds ? Array.from(externalDeletedIds) : []);
  const items = Array.isArray(list) ? list : [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    const extracted = extractDeletedMessageIds(item);
    for (let j = 0; j < extracted.length; j += 1) {
      const id = extracted[j];
      combined.add(id);
      if (!foundSet.has(id)) {
        foundSet.add(id);
        deletedIdsFound.push(id);
      }
    }
  }

  const visible = items.filter(
    (item): item is T =>
      Boolean(item) && !isHiddenControlMessage(item) && !matchesDeletedMessageId(item, combined),
  );
  return { visible, deletedIdsFound };
}

export function getRoomMessageSearchHaystack(item: RoomMessageWire, room: Member): string {
  if (!item || typeof item !== 'object') return '';
  const hit = messageSearchHaystackCache.get(item);
  if (hit !== undefined) return hit;
  const profile = senderProfile(item, room);
  const text = messageText(item);
  const haystack = `${text}\u0001${profile.name}\u0001${profile.id}`.toLowerCase();
  messageSearchHaystackCache.set(item, haystack);
  return haystack;
}

export function buildRoomMetaSearchHaystack(room?: Member | null): string {
  if (!room) return '';
  return `${room.ownerName || ''}\u0001${room.team || ''}\u0001${room.groupName || ''}`.toLowerCase();
}

export function mergeMessages<T extends RoomMessageWire>(prev: T[], next: RoomMessageWire[]): T[] {
  const cleanPrevRaw = prev.filter(Boolean);
  if (cleanPrevRaw.length !== prev.length) diagnoseUndefined(prev, 'MERGE_PREV');
  const cleanNextRaw = Array.isArray(next) ? next.filter(Boolean) : [];

  const deletedIds = new Set<string>();
  for (let i = 0; i < cleanPrevRaw.length; i += 1) {
    extractDeletedMessageIds(cleanPrevRaw[i]).forEach((id) => deletedIds.add(id));
  }
  for (let i = 0; i < cleanNextRaw.length; i += 1) {
    extractDeletedMessageIds(cleanNextRaw[i]).forEach((id) => deletedIds.add(id));
  }

  const cleanPrev = cleanPrevRaw.filter(
    (item) => !isHiddenControlMessage(item) && !matchesDeletedMessageId(item, deletedIds),
  );
  const removedFromPrev = cleanPrev.length !== prev.length;

  const cleanNext = cleanNextRaw.filter(
    (item) => !isHiddenControlMessage(item) && !matchesDeletedMessageId(item, deletedIds),
  );
  if (cleanNext.length === 0 && !removedFromPrev) return prev;

  const seen = new Set<string>();
  const registerSeen = (item: RoomMessageWire) => {
    seen.add(messageKey(item));
    collectRoomMessageIds(item).forEach((id) => seen.add(id));
  };
  const hasSeen = (item: RoomMessageWire) =>
    seen.has(messageKey(item)) || collectRoomMessageIds(item).some((id) => seen.has(id));

  cleanPrev.forEach(registerSeen);
  const merged = [...cleanPrev];
  let added = 0;
  for (let i = 0; i < cleanNext.length; i += 1) {
    const item = cleanNext[i];
    if (hasSeen(item)) continue;
    registerSeen(item);
    merged.push(item as T);
    added += 1;
  }
  if (added === 0 && !removedFromPrev) return prev;
  return sortMessagesNewestFirst(merged);
}

export function roomGiftInfo(
  item: RoomMessageWire,
): { name: string; num: number; image: string; total: string } | null {
  if (!item) return null;
  const body = messageBody(item);
  const ext = extraInfo(item);
  const msgType = String(
    item.msgType || item.extMsgType || body.msgType || body.extMsgType || body.messageType || '',
  ).toUpperCase();
  const giftReplyInfo = body.giftReplyInfo || ext.giftReplyInfo || {};
  const rawReplyGiftInfo = giftReplyInfo?.replyGiftInfo;
  const replyGiftInfo =
    rawReplyGiftInfo && typeof rawReplyGiftInfo === 'object' && Object.keys(rawReplyGiftInfo).length
      ? rawReplyGiftInfo
      : null;

  if (msgType.includes('REPLY')) {
    return null;
  }
  const giftInfo =
    body.giftInfo ||
    giftReplyInfo.giftInfo ||
    replyGiftInfo ||
    ext.giftInfo ||
    item.giftInfo ||
    (body.giftName || body.giftId || body.giftNum ? body : null);

  if (!giftInfo && !msgType.includes('GIFT')) return null;
  if (msgType.includes('LIVE') && !giftInfo) return null;
  const name =
    firstTextFrom([giftInfo, replyGiftInfo, giftReplyInfo, body], ['giftName', 'name']) ||
    t('礼物');
  const num =
    Number(
      firstTextFrom(
        [giftInfo, replyGiftInfo, giftReplyInfo, body],
        ['giftNum', 'replyNum', 'num', 'count'],
      ) || '1',
    ) || 1;
  const image = normalizeUrl(
    firstTextFrom(
      [giftInfo, replyGiftInfo, giftReplyInfo, body],
      ['picPath', 'giftPic', 'image', 'icon'],
    ),
  );
  const money =
    Number(
      firstTextFrom(
        [giftInfo, replyGiftInfo, giftReplyInfo, body],
        ['money', 'replyMoney', 'cost', 'price'],
      ) || '0',
    ) || 0;
  return { name, num, image, total: money ? t('{count} 鸡腿', { count: money * num }) : '' };
}

export function mediaLabel(type: MediaType) {
  if (type === 'audio') return '\u8bed\u97f3';
  if (type === 'video') return '\u89c6\u9891';
  if (type === 'live') return '\u76f4\u64ad';
  if (type === 'image') return '\u56fe\u7247';
  return '\u94fe\u63a5';
}

const __diagStamps: Record<string, number> = {};
export function __diagStamp(key: string, intervalMs: number): boolean {
  const now = Date.now();
  if (__diagStamps[key] && now - __diagStamps[key] < intervalMs) return false;
  __diagStamps[key] = now;
  return true;
}

export function firstFrameFrom(extUser: WireRecord | null | undefined): string {
  const b = extUser?.pfUrl ?? extUser?.headFrame ?? extUser?.pictureFrame ?? extUser?.frameUrl;
  if (!b) return '';
  const first = Array.isArray(b)
    ? b[0]
    : typeof b === 'object'
      ? b[0] || b.url || b.picPath || ''
      : b;
  const u = String(first || '').trim();

  return u && !/^\[/.test(u) ? normalizeUrl(u) : '';
}

export function firstBadgeFrom(extUser: WireRecord | null | undefined): string {
  const value = [extUser?.badge, extUser?.seineBadge, extUser?.badgeList].find((item) =>
    Array.isArray(item) ? item.length > 0 : !!item,
  );
  const parsed = typeof value === 'string' ? parseMaybeJson(value) || value : value;
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const url =
    typeof first === 'string'
      ? first
      : pickText(first, ['smallPic', 'url', 'badgeUrl', 'picPath', 'image']);
  return normalizeUrl(url);
}

export function findFrameUrl(value: unknown, depth = 0): string {
  if (!value || depth > 4) return '';
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = findFrameUrl(v, depth + 1);
      if (r) return r;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const [k, v] of Object.entries(value)) {
    if (/(badge|medal|level|icon)/i.test(k)) continue;
    if (typeof v === 'string') {
      if (/(frame|pendant|bubble|border)/i.test(k) && /^(https?:\/\/|\/)/.test(v)) return v;
    } else if (v && typeof v === 'object') {
      const r = findFrameUrl(v, depth + 1);
      if (r) return r;
    }
  }
  return '';
}

export interface LiveRankItem {
  userId: string;
  rank: number;
  name: string;
  avatar: string;
  value: string;
  [key: string]: unknown;
}

export function normalizeLiveRank(res: unknown): LiveRankItem[] {
  const root = res as WireRecord | null | undefined;
  let list = unwrapList(root, [
    'content.rankList',
    'content.userRankList',
    'content.userRankingList',
    'content.contributionList',
    'content.list',
    'content.data',
    'data.rankList',
    'data.userRankList',
    'data.userRankingList',
    'data.contributionList',
    'data.list',
    'rankList',
    'userRankList',
    'userRankingList',
    'contributionList',
    'list',
  ]);
  if (!list.length) {
    const content = root?.content || root?.data || root;
    const found: WireRecord[] = [];
    const walk = (node: unknown, depth = 0) => {
      if (!node || depth > 5) return;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (typeof node !== 'object') return;
      const record = node as WireRecord;
      const hasUser = pickText(record, [
        'nickName',
        'nickname',
        'userName',
        'name',
        'userInfo.nickname',
        'userInfo.nickName',
        'user.nickname',
        'user.nickName',
      ]);
      const hasValue = pickText(record, [
        'score',
        'total',
        'cost',
        'money',
        'giftValue',
        'value',
        'amount',
        'contribution',
        'count',
        'giftNum',
      ]);
      if (hasUser || hasValue || record.userInfo || record.user) found.push(record);
      Object.values(record).forEach((value) => walk(value, depth + 1));
    };
    walk(content);
    list = found;
  }
  return list.map((item: WireRecord, index: number) => ({
    ...item,
    userId: pickText(item, [
      'userId',
      'uid',
      'id',
      'account',
      'userInfo.userId',
      'userInfo.id',
      'user.userId',
      'user.id',
      'user.userIdStr',
      'memberInfo.userId',
      'memberInfo.id',
    ]),
    rank: Number(item.rank || item.no || item.index || index + 1),
    name: pickText(
      item,
      [
        'nickName',
        'nickname',
        'userName',
        'name',
        'senderName',
        'userInfo.nickName',
        'userInfo.nickname',
        'userInfo.name',
        'user.nickName',
        'user.nickname',
        'user.userName',
        'user.name',
        'memberInfo.nickName',
        'memberInfo.nickname',
      ],
      t('用户 {id}', { id: index + 1 }),
    ),
    avatar: normalizeUrl(
      pickText(item, [
        'avatar',
        'headImg',
        'picPath',
        'userInfo.avatar',
        'userInfo.headImg',
        'user.avatar',
        'user.headImg',
        'user.userAvatar',
        'memberInfo.avatar',
      ]),
    ),
    value: pickText(
      item,
      [
        'score',
        'total',
        'cost',
        'money',
        'giftValue',
        'value',
        'amount',
        'contribution',
        'count',
        'giftNum',
      ],
      '',
    ),
  }));
}

export function avatarInitial(name: string) {
  return (name || t('用')).trim().slice(0, 1).toUpperCase();
}
