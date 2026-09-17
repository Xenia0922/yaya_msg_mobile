/**
 * 云信消息（直播弹幕 / 会话消息）编解码。
 *
 * 逆向依据（口袋48 7.1.39）：
 *   com.pocket.snh48.lib.yunxin.model.ChatMsgUtil#getBaseParams   → fromApp/roomId/sourceId/session/bubbleId/user/config
 *   com.pocket.snh48.lib.yunxin.model.ChatMsgBuilder#createBarrageNomalMessageMap
 *                                    #createBarrageMemberMessageMap
 *                                    #createTextMessageMap
 *   com.pocket.snh48.lib.yunxin.im.IMChatRoom#sendTextMessage      → type 判定 + setContent + setRemoteExtension
 */

import {
  BarrageItem,
  BarrageKind,
  NimModule,
  NimMsgType,
  NimSelfProfile,
} from './types';

/** 官方手机端 config 段（DialogConfig：build 固定 181022，其余为设备信息，服务端只做统计） */
function buildConfig() {
  return {
    build: '181022',
    mobileOperators: '',
    phoneName: 'Android',
    phoneSystemVersion: 'Android',
    version: '7.1.39',
  };
}

/**
 * 从云信消息里取出 remoteExtension（官方 SDK 里叫 remoteExtension，Web SDK 里叫 ext / custom）。
 * 版本差异较大，这里按候选字段依次兜底，字符串形态自动 JSON.parse。
 */
export function readExt(msg: any): Record<string, any> {
  if (!msg) return {};
  const candidates = [
    msg.remoteExtension,
    msg.ext,
    msg.custom,
    msg.localCustom,
    msg.content,
    msg.msg_setting_ && msg.msg_setting_.ext_,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    if (typeof raw === 'object') return raw as Record<string, any>;
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text || text[0] !== '{') continue;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        /* 非法 JSON 继续尝试下一个候选 */
      }
    }
  }
  return {};
}

/** 官方 roleId：1 成员 / 2 超管（其余为普通用户），仅在收到 ext.user 时可用 */
function toKind(messageType: string, ext: Record<string, any>): BarrageKind {
  switch (messageType) {
    case NimMsgType.BARRAGE_MEMBER:
      return 'member';
    case NimMsgType.BARRAGE_SUPERMAN:
      return 'superman';
    case NimMsgType.BARRAGE_PAY:
      return 'pay';
    case NimMsgType.BARRAGE_STARWO:
      return 'starwo';
    case NimMsgType.BARRAGE_NORMAL:
    case NimMsgType.TEXT:
    case NimMsgType.REPLY:
      return 'text';
    case NimMsgType.PRESENT:
    case NimMsgType.PRESENT_TEXT:
    case NimMsgType.PRESENT_GLOBAL:
    case NimMsgType.GENERAL_SEND_GIFT:
      return 'gift';
    case NimMsgType.EVENT_HAVEHEAD_ENTER:
    case NimMsgType.EVENT_NOHEAD_ENTER:
    case NimMsgType.EVENT_VIP_ENTER:
      return 'enter';
    default:
      break;
  }
  if (ext && ext.giftInfo) return 'gift';
  if (messageType === NimMsgType.LIVE_ANNOUNCE || messageType === NimMsgType.KTV_SONG_MSG) return 'system';
  return 'other';
}

function firstString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function toNumber(...values: any[]): number {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

/** 归一化一条云信聊天室消息；不认识的消息返回 null（例如协议层通知） */
export function parseChatroomMessage(msg: any): BarrageItem | null {
  if (!msg) return null;
  const type: string = String(msg.type || '');
  // 聊天室只关心 text / custom 两类（image、audio、file 等暂不展示）
  if (type && type !== 'text' && type !== 'custom' && type !== 'tip') return null;

  const ext = readExt(msg);
  const messageType: string = firstString(ext.messageType, type === 'text' ? NimMsgType.TEXT : '');
  const user = (ext.user && typeof ext.user === 'object' ? ext.user : {}) as Record<string, any>;
  const kind = toKind(messageType, ext);

  const nick = firstString(user.nickName, user.nickname, msg.fromNick, msg.from);
  const avatar = firstString(user.avatar, msg.fromAvatar);
  const userId = toNumber(user.userId, user.id, user.uid);
  const roleId = toNumber(user.roleId);
  const level = toNumber(user.level);

  let text = firstString(ext.text, msg.text);
  let gift: BarrageItem['gift'];

  if (kind === 'gift') {
    const giftInfo = (ext.giftInfo || {}) as Record<string, any>;
    const acceptUser = (giftInfo.acceptUser || {}) as Record<string, any>;
    const giftName = firstString(giftInfo.giftName, giftInfo.name);
    const giftNum = toNumber(giftInfo.giftNum, 1);
    const tpNum = toNumber(giftInfo.tpNum);
    const toName = firstString(acceptUser.userName, acceptUser.nickName);
    gift = {
      giftId: toNumber(giftInfo.giftId),
      giftName,
      giftNum,
      tpNum,
      toName,
      picPath: firstString(giftInfo.picPath, giftInfo.icon),
    };
    if (!text) {
      text = toName ? `${nick} 送给 ${toName} ${giftNum}个${giftName}` : `${nick} 送出 ${giftNum}个${giftName}`;
    }
  } else if (kind === 'enter' && !text) {
    text = `${nick} 进入直播间`;
  }

  if (!text && kind !== 'gift') return null;

  return {
    id: firstString(msg.idClient, msg.idServer, msg.uuid, `${nick}-${msg.time}-${text}`),
    kind,
    messageType: messageType || type,
    text,
    nick,
    avatar,
    userId,
    roleId,
    level,
    time: toNumber(msg.time, Date.now()),
    ...(gift ? { gift } : {}),
  };
}

export interface BuildLiveBarrageOptions {
  /** 聊天室 id（= getLiveOne 返回的 content.roomId） */
  roomId: string | number;
  /** 直播 id（官方 sourceId） */
  sourceId: string | number;
  text: string;
  self: NimSelfProfile;
  /** 'live' 成员直播 / 'public' 公开直播（官方 ModuleType） */
  module?: string;
  /** 弹幕类型，默认 BARRAGE_NORMAL */
  messageType?: string;
  /** 进房榜单内（inTop） */
  inTop?: boolean;
  /** 官方 IM 防伪签名 key（来自启动配置 klbrmk），有则带上 */
  imKey?: string;
  /** 消息 uuid（签名用，缺省由 SDK 生成，此处仅官方同款兼容） */
  uuid?: string;
}

/**
 * 构造直播弹幕 remoteExtension（对齐 ChatMsgBuilder.createBarrageNomalMessageMap
 * + ChatMsgUtil.getBaseParams，字段顺序/取值与官方一致）。
 */
export function buildLiveBarrageExt(options: BuildLiveBarrageOptions): Record<string, any> {
  const { roomId, sourceId, text, self } = options;
  const ext: Record<string, any> = {
    fromApp: '201811',
    roomId: String(roomId),
    sourceId: String(sourceId),
    session: 0,
    bubbleId: '0',
    user: {
      userId: self.userId,
      nickName: self.nickName,
      avatar: self.avatar,
      level: self.level ?? 0,
      roleId: self.roleId ?? 0,
      // 桌面版同款：其他客户端渲染徽章/VIP 标时会读这几个字段
      vip: self.vip === true,
      pfUrl: self.pfUrl || '',
      teamLogo: self.teamLogo ?? null,
      badge: Array.isArray(self.badge) ? self.badge : [],
    },
    config: buildConfig(),
    text,
    messageType: options.messageType || NimMsgType.BARRAGE_NORMAL,
    module: options.module || NimModule.LIVE,
    inTop: options.inTop === true,
    // 官方 UserInfo 字段叫 sessionRole（桌面版 custom 里也是它）；原有 `session` 保留，两个都带
    sessionRole: 0,
  };
  if (options.imKey) {
    // 官方 IMChatRoom#sendMsg 会把 md5 塞进 remoteExtension，供其他客户端校验消息真伪
    ext.md5 = md5Hex(`${options.uuid || ''}${self.accid || ''}${options.imKey}`);
  }
  return ext;
}

export interface BuildSessionTextOptions {
  /** 会话房间 id（官方 getRoomInfo().realRoomId） */
  roomId: string | number;
  /** 会话 sourceId（官方传 sessionId/fromAccount，TEXT 场景传自身 id） */
  sourceId: string | number;
  text: string;
  self: NimSelfProfile;
  /** 气泡 id，官方默认 '0' */
  bubbleId?: string;
}

/** 构造会话（私信/房间）文本消息 remoteExtension（ChatMsgBuilder.createTextMessageMap） */
export function buildSessionTextExt(options: BuildSessionTextOptions): Record<string, any> {
  const { roomId, sourceId, text, self } = options;
  return {
    fromApp: '201811',
    roomId: String(roomId),
    sourceId: String(sourceId),
    session: 0,
    bubbleId: options.bubbleId || '0',
    user: {
      userId: self.userId,
      nickName: self.nickName,
      avatar: self.avatar,
      level: self.level ?? 0,
      roleId: self.roleId ?? 0,
    },
    config: buildConfig(),
    text,
    messageType: NimMsgType.TEXT,
    module: NimModule.SESSION,
  };
}

/**
 * MD5（官方 MessageMD5Util.Md5 的等价实现）。仅用于消息防伪标记，非安全用途。
 * 说明：RN 无 node:crypto，这里用标准 RFC1321 实现，避免新增依赖。
 */
export function md5Hex(input: string): string {
  const add = (a: number, b: number): number => {
    const low = (a & 0xffff) + (b & 0xffff);
    return (((a >>> 16) + (b >>> 16) + (low >>> 16)) << 16) | (low & 0xffff);
  };
  const rol = (n: number, c: number): number => (n << c) | (n >>> (32 - c));
  const cmn = (q: number, a: number, b: number, x: number, s: number, t: number): number =>
    add(rol(add(add(a, q), add(x, t)), s), b);
  const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number): number =>
    cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number): number =>
    cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number): number =>
    cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number): number =>
    cmn(c ^ (b | ~d), a, b, x, s, t);

  const str = unescape(encodeURIComponent(input));
  const len = str.length;
  const total = (((len + 8) >> 6) + 1) * 16;
  const x: number[] = new Array(total).fill(0);
  for (let i = 0; i < len; i += 1) {
    x[i >> 2] |= (str.charCodeAt(i) & 0xff) << ((i % 4) * 8);
  }
  x[len >> 2] |= 0x80 << ((len % 4) * 8);
  x[total - 2] = len * 8;
  x[total - 1] = Math.floor((len * 8) / 0x100000000);

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < total; i += 16) {
    const oa = a;
    const ob = b;
    const oc = c;
    const od = d;
    a = ff(a, b, c, d, x[i], 7, -680876936);
    d = ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10], 17, -42063);
    b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = gg(b, c, d, a, x[i], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5], 4, -378558);
    d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = hh(d, a, b, c, x[i], 11, -358537222);
    c = hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = ii(a, b, c, d, x[i], 6, -198630844);
    d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = ii(b, c, d, a, x[i + 9], 21, -343485551);

    a = add(a, oa);
    b = add(b, ob);
    c = add(c, oc);
    d = add(d, od);
  }

  const hex = (num: number): string => {
    let out = '';
    for (let i = 0; i < 4; i += 1) {
      out += `0${((num >>> (i * 8)) & 0xff).toString(16)}`.slice(-2);
    }
    return out;
  };
  return `${hex(a)}${hex(b)}${hex(c)}${hex(d)}`;
}
