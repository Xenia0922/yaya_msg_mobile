/**
 * 房间消息域纯函数（从 FollowedRoomsScreen 抽出，无 React 依赖）。
 *
 * 范围：消息体解析、时间归一、合并排序、QChat 消息转换、最新消息挑选、房间标签。
 * ⚠️ 全部为**原样搬迁**（逐字复制），未改任何规则。
 */
import { messagePayload, normalizeUrl, parseMaybeJson, pickText } from '../../utils/data';
import { toMs } from '../../utils/format';
import { t } from '../../i18n';
import { Member, RoomMessage } from '../../types';
import { type RoomLiveMessage } from '../../services/pocketNim/qchat';

export type RoomMode = 'big' | 'small';

/** 通用文本限位（房间名等） */
export function capText(text: string, max = 18) {
  const clean = (text || '').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** 送礼面板网格单元格的礼物图（picPath 为相对路径 → normalizeUrl 补全域名） */
export function rgiftImage(g: any): string {
  return normalizeUrl(g?.picPath || g?.icon || g?.giftPic || g?.url || '');
}

export function parseObject(value: any) {
  const parsed = parseMaybeJson(value);
  if (parsed && typeof parsed === 'object') return parsed;
  return {};
}

export function extraInfo(item: any) {
  return parseObject(item?.extInfo);
}

export function messageBody(item: any) {
  const body = messagePayload(item);
  return body && typeof body === 'object' ? body : {};
}

export function firstTextFrom(objects: any[], paths: string[]) {
  for (const obj of objects) {
    const value = pickText(obj, paths);
    if (value) return value;
  }
  return '';
}

export function deepFindText(value: any, keys: string[], depth = 0): string {
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
  for (const key of keys) {
    const direct = value[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct);
  }
  for (const child of Object.values(value)) {
    const found = deepFindText(child, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

/**
 * 消息时间统一【归一为毫秒】。
 *
 * ⚠️ 单位混用会造成两处致命后果（2026-10-03 修复）：
 *  1) 排序错乱：HTTP 历史消息的 msgTime 是**秒**，QChat/NIM 推送的 time 是**毫秒**，
 *     直接比较会把毫秒消息全排到最前并「钉死」。
 *  2) 轮询水位污染：refreshRoomMessages 用「列表最大原始时间」当水位，
 *     一旦毫秒值（~1.7e12）进入列表顶部，HTTP 秒级新消息（~1.7e9）永远小于水位 →
 *     `hasFresh=false` 直接 return，**聊天流永久冻结（新消息永不上屏）**。
 * 统一走 toMs（10 位当秒转毫秒、13 位原样），比较/排序/去重键全部使用归一后的值。
 */
export function getMessageTime(item: any): number {
  return toMs(item?.msgTime ?? item?.messageTime ?? item?.ctime ?? item?.time) || 0;
}

export function getNextTime(res: any, list: any[]): number {
  const direct = Number(firstTextFrom([res?.content, res?.data, res], ['nextTime', 'next', 'lastTime']));
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 0;
}

// 诊断标记：undefined/null 元素究竟是「首次进入就带毒」还是「merge 累积污染」由这里打印栈标记区分
let __msgDiagTag = 'INIT';
export function diagnoseUndefined(list: any[], tag: string) {
  if (!Array.isArray(list)) return;
  const bad = list
    .map((it, i) => (it == null ? i : -1))
    .filter((i) => i >= 0);
  if (bad.length) {
    // 真机/调试时可见：指出是哪个入口首次把 undefined 写进 roomMessages
    // eslint-disable-next-line no-console
    console.warn(`[msgDiag:${tag}] 检出 ${bad.length} 个 null/undefined 元素，下标=[${bad.slice(0, 20).join(',')}]`, {
      rawSample: list.slice(0, 5),
      stack: new Error().stack,
    });
  }
}

export function sortMessagesNewestFirst<T>(list: T[]): T[] {
  return list.slice().sort((a: any, b: any) => getMessageTime(b) - getMessageTime(a));
}

export function qchatToRoomMessage(msg: RoomLiveMessage): any {
  const user = (msg.ext?.user && typeof msg.ext.user === 'object' ? msg.ext.user : {}) as Record<string, any>;
  const nickName = String(user.nickName || user.nickname || msg.fromNick || '');
  return {
    uuid: msg.uuid,
    msgId: msg.uuid,
    msgTime: msg.time,
    time: msg.time,
    msgType: msg.messageType,
    // bodys 沿用 HTTP 消息的「JSON 体」形态：正文 + 类型 + 发送者
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
    /** 标记来源：实时（用于排查），不影响渲染 */
    __live: true,
  };
}

/**
 * 大房间最新消息：只认 channelId===大房间 或 成员本人发言。
 * 注意不能按 serverId 兜底——小房间与大房间共用 serverId，兜底会把小房间消息冒充大房间预览。
 */
export function findLastMessage(messages: any[], member?: Member) {
  if (!member) return null;
  const bigId = String(member.channelId || '');
  const ykid = String(member.yklzId || '');
  // ① 精确匹配大房间 channelId（唯一可靠判据 —— lastMsgList 有 channelId 字段）
  if (bigId) {
    const exact = messages.find((msg) => String(msg.channelId || '') === bigId);
    if (exact) return exact;
  }
  // ② 兜底：只有 userId/ownerId 命中成员 id，且**不是小房间消息**（否则小房间消息会冒充大房间预览）
  return messages.find((msg) => (
    String(msg.userId || msg.ownerId || '') === String(member.id || '')
    && (!ykid || ykid === '0' || String(msg.channelId || '') !== ykid)
  )) || null;
}

/** 小房间（yklzId）最新消息：只认 channelId 精确匹配小房间 */
export function findSmallLastMessage(messages: any[], member?: Member) {
  if (!member) return null;
  const ykid = String(member.yklzId || '');
  if (!ykid || ykid === '0' || ykid === 'undefined') return null;
  return messages.find((msg) => String(msg.channelId || '') === ykid)
    || null;
}

export function roomChannelId(member: Member, mode: RoomMode) {
  return String(mode === 'small' ? (member.yklzId || '') : (member.channelId || ''));
}

export function roomLabel(member: Member, mode: RoomMode) {
  return mode === 'small'
    ? t('小房间 {id}', { id: member.yklzId || t('未配置') })
    : t('大房间 {id}', { id: member.channelId || t('未配置') });
}

export type { RoomMessage };
