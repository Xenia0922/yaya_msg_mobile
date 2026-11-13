/**
 * 房间消息域：发送者解析 / 身份角色 / 消息键与合并 / 礼物与标签 / 头像框等纯函数。
 * 从 FollowedRoomsScreen 抽出（逐字搬迁，规则未改）。
 */
import { Member, RoomMessage } from '../../types';
import { t } from '../../i18n';
import { normalizeUrl, unwrapList, parseMaybeJson, pickText } from '../../utils/data';
import { type MediaType } from './mediaUtils';
import { messageBody, extraInfo, deepFindText, firstTextFrom, getMessageTime, diagnoseUndefined, sortMessagesNewestFirst, rgiftImage } from './messageUtils';

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

export function senderProfile(item: any, room: Member): SenderProfile {
  if (!item) return { id: '', name: t('未知用户'), avatar: '' };
  const body = messageBody(item);
  // ⚠️ 只把 extraInfo 的 **user 段**当发送者资料（官方 getChannelBaseParams / 我们 buildChannelExt
  // 写入的都是发送者），不要把整个 ext 混进下面的字段查找 —— ext 里还有 replyInfo（被回复者）。
  const extUser: any = ((extraInfo(item) as any)?.user) || {};
  const objects = [item, body];
  const id =
    firstTextFrom(objects, [
      'senderUserId',
      'senderId',
      'fromUserId',
      'fromAccount',
      'userId',
      'uid',
      'account',
      'sender.userId',
      'sender.id',
      'user.userId',
      'user.id',
      'message.userId',
      'message.senderId',
    ])
    || String(extUser.userId ?? extUser.id ?? '').trim()
    || deepFindText(objects, ['senderUserId', 'fromUserId', 'userId', 'uid']);
  const topName = firstTextFrom(objects, [
    'senderName',
    'senderNickName',
    'nickName',
    'nickname',
    'userName',
    'name',
    'fromNickName',
    'sender.nickName',
    'sender.nickname',
    'sender.name',
    'user.nickName',
    'user.nickname',
    'user.name',
    'message.nickName',
    'message.nickname',
  ]) || deepFindText(objects, ['nickName', 'nickname', 'senderName', 'userName', 'name']);
  const name = String(extUser.nickName || extUser.nickname || '').trim() || topName;
  const topAvatar = firstTextFrom(objects, [
    'avatar',
    'senderAvatar',
    'headImg',
    'headUrl',
    'sender.avatar',
    'sender.headImg',
    'user.avatar',
    'user.headImg',
    'userInfo.avatar',
    'userInfo.headImg',
    'message.avatar',
    'message.headImg',
  ]) || deepFindText(objects, ['senderAvatar', 'avatar', 'headImg', 'headUrl']); // 仅小头像字段，勿深扫 picPath 大图
  const avatar = normalizeUrl(String(extUser.avatar || '').trim() || topAvatar);

  return {
    // ⚠️ 归一化 trim（2026-10-03 修复）：id 带空白时 memberIds.has / profile.id === currentUserId
    id: String(id || '').trim(),
    name: name || (id ? t('用户 {id}', { id }) : t('未知用户')),
    avatar: avatar || '',
  };
}

export function isIdolMessage(item: any, room: Member, includeFans: boolean) {
  // room 可能为空（房间切走/关闭时 chatRows 的 memo 仍可能重算）：不能直接读 room.id，否则整屏 CRASH
  if (!room) return false;
  const body = messageBody(item);
  const ext = extraInfo(item);
  const profile = senderProfile(item, room);
  const ownerIds = [room.id, (room as any).userId, (room as any).memberId].map(String).filter(Boolean);
  if (profile.id && ownerIds.includes(String(profile.id))) return true;
  // 已识别出发送者 ID 且不是房主（其他成员/粉丝在别人房间发言）：显示自己的名字，不套用房主身份
  if (profile.id) return false;
  // 拿不到发送者 ID：退回原来的判断逻辑
  if (!includeFans) return true;
  const role = firstTextFrom([item, ext, body], ['roleId', 'user.roleId', 'sender.roleId', 'message.roleId']);
  if (role && ['2', '3', '4', 'star', 'idol'].includes(String(role).toLowerCase())) return true;
  return false;
}

export function currentUserIdFrom(res: any): string {
  return firstTextFrom([res?.content, res?.data, res], [
    'userInfo.userId',
    'userInfo.id',
    'user.userId',
    'user.id',
    'userId',
    'id',
    'account',
  ]);
}

export function messageRole(
  item: any,
  room: Member,
  includeFans: boolean,
  currentUserId: string,
  memberIds?: Set<string>,
): MessageRole {
  if (!item) return 'fan';
  const profile = senderProfile(item, room);
  if (includeFans && currentUserId && profile.id && String(profile.id) === String(currentUserId)) return 'mine';
  if (isIdolMessage(item, room, includeFans)) return 'idol';
  // 其他成员（成员库里的成员，但不是本房房主）在别人房间发言 → 也算「成员消息」。
  // 用户要求：切到「成员消息」时，别的成员的消息不能被当成粉丝消息过滤掉。
  if (profile.id && memberIds && memberIds.has(String(profile.id))) return 'idol';
  return 'fan';
}

/** 关注 id → 成员匹配：friends/id 返回的是口袋 userId（= 库 id），但也可能落到
 *  userId/account/昵称上（库字段异构、新成员入库延迟）。逐字段兜底，避免
 *  「已关注却不显示在房间列表」（周文迪等 2026-09 后新成员，2026-10-19 用户反馈）。 */
export function matchFollowedMember(members: any[], id: string): any | undefined {
  const target = String(id || '').trim();
  if (!target) return undefined;
  return members.find((item: any) => {
    const ids = [item?.id, item?.userId, item?.memberId, item?.account].map((v) => String(v ?? '').trim());
    return ids.includes(target);
  });
}

/** 成员库 id 集合（成员 id / userId / memberId 都可能出现在消息里） */
export function buildMemberIdSet(members: any[]): Set<string> {
  const set = new Set<string>();
  (members || []).forEach((m: any) => {
    [m?.id, m?.userId, m?.memberId].forEach((v) => {
      const s = String(v ?? '').trim();
      if (s) set.add(s);
    });
  });
  return set;
}


export function userCardFromUserRes(res: any) {
  const content = res?.content || res?.data?.content || res?.data || res || {};
  const userInfo = content?.userInfo || content?.user || content?.profile || content || {};
  const base = userInfo?.baseUserInfo || userInfo?.baseInfo || userInfo || {};
  const star = content?.starInfo || content?.memberInfo || userInfo?.starInfo || {};
  const objs = [base, userInfo, star, content];
  const pick = (keys: string[]) => firstTextFrom(objs, keys);
  //   relation / relationType / followStatus / friendStatus / isFollow / followed / isFriend
  //     mutual|both|friend|friends|2|3 → 互相关注；true|followed|following|1 → 已关注
  const relationValue = String(
    pick(['relation', 'relationType', 'followStatus', 'friendStatus', 'isFollow', 'followed', 'isFriend', 'relationship']) || '',
  ).trim().toLowerCase();
  const mutual = ['mutual', 'both', 'friend', 'friends', '2', '3'].includes(relationValue);
  const following = mutual || ['true', 'followed', 'following', '1'].includes(relationValue);
  return {
    name: pick(['nickName', 'nickname', 'userName', 'name', 'starName', 'realNickName', 'baseUserInfo.nickName']),
    avatar: normalizeUrl(pick(['avatar', 'avatarUrl', 'faceImage', 'headImg', 'headUrl', 'starAvatar'])),
    level: pick(['level', 'userLevel', 'grade', 'vipLevel', 'userLevelName']),
    signature: pick(['signature', 'sign', 'intro', 'description', 'userSignature']),
    team: pick(['starTeamName', 'teamName', 'team']),
    period: pick(['periodName', 'period']),
    isStar: !!(star && (star.starName || star.starId)) || base?.isStar === true || base?.star === true,
    following,
    mutual,
  };
}

export function messageKey(item: any) {
  if (!item) return `empty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const direct = item.id || item.msgId || item.messageId || item.clientMsgId || item.uuid || item.msgUuid;
  if (direct) return String(direct);
  const profile = senderProfile(item, {} as Member);
  const body = messageBody(item);
  const text = firstTextFrom([body, item], ['text', 'message', 'msgContent', 'content', 'bodys', 'body']);
  const media = firstTextFrom([body, item], ['url', 'fileUrl', 'pictureUrl', 'coverUrl', 'liveId']);
  // 注意：兜底键【不含 index】—— 同一消息在不同 list 中 index 不同会导致去重失败、重复累积。
  // 无稳定 id 时以 时间+发送者+内容 作近似键，足以区分不同消息并拦截同批重复。
  return String(`${getMessageTime(item)}-${profile.id || profile.name || ''}-${text || media || JSON.stringify(body).slice(0, 120)}`);
}




export function mergeMessages(prev: RoomMessage[], next: RoomMessage[]) {
  // 根因防御：prev / next 任一含 undefined 都会「累积污染」整个聊天记录（之前只在外层 filter，
  // 但 prev 一旦带毒，后续 merge 永远带毒，最终在 renderChatItem 崩溃）。这里双端都过滤 + 诊断。
  const cleanPrev = prev.filter(Boolean);
  if (cleanPrev.length !== prev.length) diagnoseUndefined(prev, 'MERGE_PREV');
  const seen = new Set(cleanPrev.map((item) => messageKey(item)));
  const merged = [...cleanPrev];
  next.filter(Boolean).forEach((item) => {
    const key = messageKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return sortMessagesNewestFirst(merged);
}

export function roomGiftInfo(item: any): { name: string; num: number; image: string; total: string } | null {
  if (!item) return null;
  const body = messageBody(item);
  const ext = extraInfo(item);
  const msgType = String(item.msgType || item.extMsgType || body.msgType || body.extMsgType || body.messageType || '').toUpperCase();
  const giftReplyInfo = body.giftReplyInfo || ext.giftReplyInfo || {};
  const giftInfo = body.giftInfo || giftReplyInfo.giftInfo || ext.giftInfo || item.giftInfo || null;
  if (!giftInfo && !msgType.includes('GIFT') && String(item.msgType) !== '7') return null;
  if (msgType.includes('LIVE') && !giftInfo) return null;
  const source = giftInfo || giftReplyInfo || body;
  const name = firstTextFrom([giftInfo, giftReplyInfo, body], ['giftName', 'replyName', 'name']) || t('礼物');
  const num = Number(firstTextFrom([giftInfo, giftReplyInfo, body], ['giftNum', 'replyNum', 'num', 'count']) || '1') || 1;
  const image = normalizeUrl(firstTextFrom([giftInfo, giftReplyInfo, body], ['picPath', 'giftPic', 'image', 'icon']));
  const money = Number(firstTextFrom([giftInfo, giftReplyInfo, body], ['money', 'replyMoney', 'cost', 'price']) || '0') || 0;
  return { name, num, image, total: money ? t('{count} 鸡腿', { count: money * num }) : '' };
}

export function mediaLabel(type: MediaType) {
  if (type === 'audio') return '\u8bed\u97f3';
  if (type === 'video') return '\u89c6\u9891';
  if (type === 'live') return '\u76f4\u64ad';
  if (type === 'image') return '\u56fe\u7247';
  return '\u94fe\u63a5';
}

// 限频诊断日志：同 key 在 intervalMs 内只打印一次，便于在 release 包观察真实数据而不刷屏
const __diagStamps: Record<string, number> = {};
export function __diagStamp(key: string, intervalMs: number): boolean {
  const now = Date.now();
  if (__diagStamps[key] && now - __diagStamps[key] < intervalMs) return false;
  __diagStamps[key] = now;
  return true;
}

export function firstFrameFrom(extUser: any): string {
  const b = extUser?.pfUrl ?? extUser?.headFrame ?? extUser?.pictureFrame ?? extUser?.frameUrl;
  if (!b) return '';
  const first = Array.isArray(b) ? b[0] : (typeof b === 'object' ? (b[0] || b.url || b.picPath || '') : b);
  const u = String(first || '').trim();
  // 相对路径（/…）也算有效 —— normalizeUrl 会按宿主补齐
  return u && !/^\[/.test(u) ? normalizeUrl(u) : '';
}

/** 房间消息只显示第一枚勋章，不把它当头像框或消息图片。 */
export function firstBadgeFrom(extUser: any): string {
  const value = [extUser?.badge, extUser?.seineBadge, extUser?.badgeList].find((item) => Array.isArray(item) ? item.length > 0 : !!item);
  const parsed = typeof value === 'string' ? (parseMaybeJson(value) || value) : value;
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const url = typeof first === 'string' ? first : pickText(first, ['smallPic', 'url', 'badgeUrl', 'picPath', 'image']);
  return normalizeUrl(url);
}

/**
 * 从 user/info/home 响应里泛匹配头像框地址：官方各端字段名不统一
 * （pictureFrame / pfUrl / headFrame / bubble…），按「key 含框类词 + 值是 URL」匹配。
 * 拿不到返回空串 —— 资料卡就不叠框，不影响主流程。
 * ⚠️ badge / medal / level 类键一律跳过（勋章 ≠ 头像框，2026-10-19 语义互换教训）。
 */
export function findFrameUrl(value: any, depth = 0): string {
  if (!value || depth > 4) return '';
  if (Array.isArray(value)) {
    for (const v of value) { const r = findFrameUrl(v, depth + 1); if (r) return r; }
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

export function normalizeLiveRank(res: any): any[] {
  let list = unwrapList(res, [
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
    const content = res?.content || res?.data || res;
    const found: any[] = [];
    const walk = (node: any, depth = 0) => {
      if (!node || depth > 5) return;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (typeof node !== 'object') return;
      const hasUser = pickText(node, ['nickName', 'nickname', 'userName', 'name', 'userInfo.nickname', 'userInfo.nickName', 'user.nickname', 'user.nickName']);
      const hasValue = pickText(node, ['score', 'total', 'cost', 'money', 'giftValue', 'value', 'amount', 'contribution', 'count', 'giftNum']);
      if (hasUser || hasValue || node.userInfo || node.user) found.push(node);
      Object.values(node).forEach((value) => walk(value, depth + 1));
    };
    walk(content);
    list = found;
  }
  return list.map((item: any, index: number) => ({
    ...item,
    userId: pickText(item, ['userId', 'uid', 'id', 'account', 'userInfo.userId', 'userInfo.id', 'user.userId', 'user.id', 'user.userIdStr', 'memberInfo.userId', 'memberInfo.id']),
    rank: Number(item.rank || item.no || item.index || index + 1),
    name: pickText(item, [
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
    ], t('用户 {id}', { id: index + 1 })),
    avatar: normalizeUrl(pickText(item, [
      'avatar',
      'headImg',
      'picPath',
      'userInfo.avatar',
      'userInfo.headImg',
      'user.avatar',
      'user.headImg',
      'user.userAvatar',
      'memberInfo.avatar',
    ])),
    value: pickText(item, ['score', 'total', 'cost', 'money', 'giftValue', 'value', 'amount', 'contribution', 'count', 'giftNum'], ''),
  }));
}

export function avatarInitial(name: string) {
  return (name || t('用')).trim().slice(0, 1).toUpperCase();
}
