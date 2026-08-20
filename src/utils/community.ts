/**
 * Area48 社区数据归一化工具（社区模块专用）
 *
 * 职责：
 *  1. normalizeCommunityPost —— 把 feed / 详情响应里的帖子字段统一成移动端视图模型；
 *  2. normalizeCommunityComments —— 把评论响应（commentList + commentUserList）归一化；
 *  3. stripRichText —— 帖子正文是 HTML 片段（<br> + post:// / snh48:// / topic:// 协议链接），
 *     移动端不做协议跳转，剥离成保留换行的纯文本；
 *  4. checkMaskWords —— 发帖 / 评论前的屏蔽词校验（词库获取失败时 fail-open，不阻断发言）。
 *
 * 字段名参照桌面端 yk1z/yaya_msg community-feature.js 的多路兜底取值，保证结构变化时仍可解析。
 */
import { pocketApi } from '../api/pocket48';

export interface CommunityPost {
  postId: string;
  title: string;
  /** 纯文本正文（已剥离 HTML / 协议链接） */
  text: string;
  /** 归一化后的图片 URL（最多 9 张） */
  images: string[];
  viewCount: number;
  likeCount: number;
  commentCount: number;
  /** 毫秒时间戳（响应为秒级时自动 ×1000） */
  time: number;
  userId: string;
  name: string;
  avatar: string;
}

export interface CommunityComment {
  commentId: string;
  userId: string;
  name: string;
  avatar: string;
  text: string;
  time: number;
}

/** 按点分路径从嵌套对象取值（user.realNickName 等），空值视为未命中 */
function deepPick(obj: any, paths: string[]): any {
  for (const path of paths) {
    let cur = obj;
    let found = true;
    for (const key of path.split('.')) {
      if (cur == null) {
        found = false;
        break;
      }
      cur = cur[key];
    }
    if (found && cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
}

function toUrl(value: any): string {
  const text = String(value || '').trim();
  if (!text) return '';
  // 口袋接口返回相对路径：补齐 CDN 域名（头像/帖子图片都是 /xxx.jpg 形态）
  if (text.startsWith('//')) return `https:${text}`;
  if (text.startsWith('/')) return `https://source.48.cn${text}`;
  if (text.startsWith('http://')) return text.replace(/^http:/i, 'https:');
  return text;
}

/**
 * 剥离富文本为纯文本：
 * - <br> → 换行；其余标签删除（保留标签内文字）；
 * - 常见 HTML 实体解码（&amp; 最后解码，避免二次转义）。
 */
export function stripRichText(value: any): string {
  let text = String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 归一化单个帖子。
 * 兼容两种入参形态：
 *  - feed 条目：{ type:'POSTS', data: { postsInfo|post|帖子字段 } }
 *  - 详情响应：content 整体（postsInfo|post 字段直接挂在 content 上）
 */
export function normalizeCommunityPost(raw: any): CommunityPost | null {
  if (!raw || typeof raw !== 'object') return null;
  const wrapped = raw.data || raw;
  const post = wrapped.postsInfo || wrapped.post || wrapped;
  if (!post || typeof post !== 'object') return null;
  // Area48 老接口用户信息可能挂在 post/wrapped 的多处（baseUserInfo / userInfo / user）
  const user =
    post.user || post.baseUserInfo || post.userInfo
    || wrapped.user || wrapped.baseUserInfo || wrapped.userInfo || {};

  const postId = String(deepPick(post, ['postId', 'id']) || deepPick(wrapped, ['postId', 'id']) || '').trim();
  if (!postId) return null;

  const rawImages = deepPick(post, ['previewImg', 'imgs', 'images', 'imageList', 'imgList']) || [];
  const images = (Array.isArray(rawImages) ? rawImages : [rawImages])
    .map((img: any) => {
      if (img && typeof img === 'object') return toUrl(deepPick(img, ['imgUrl', 'imagePath', 'imgPath', 'url']));
      return toUrl(img);
    })
    .filter(Boolean)
    .slice(0, 9);

  const time = Number(deepPick(post, ['createAt', 'ctime', 'time', 'createTime']) || 0);
  const userName = String(
    deepPick(user, ['realNickName', 'nickName', 'nickname', 'starName', 'name', 'userName'])
    || deepPick(post, [
      'realNickName', 'nickName', 'nickname', 'name', 'userName',
      'baseUserInfo.realNickName', 'baseUserInfo.nickName', 'baseUserInfo.nickname',
      'userInfo.nickName', 'userInfo.nickname',
    ])
    || '用户',
  ).trim();
  const avatarUrl = toUrl(
    deepPick(user, ['avatar', 'avatarPath', 'headImg', 'headImgUrl', 'headUrl', 'picUrl', 'picPath', 'icon', 'userAvatar', 'img'])
    || deepPick(post, [
      'avatar', 'avatarPath', 'headImg', 'headImgUrl', 'headUrl', 'picUrl', 'picPath', 'icon', 'userAvatar',
      'baseUserInfo.avatar', 'baseUserInfo.avatarPath', 'baseUserInfo.headImg',
      'userInfo.avatar', 'userInfo.avatarPath', 'userInfo.headImg',
    ])
    || '',
  );

  return {
    postId,
    title: String(deepPick(post, ['title']) || '').trim(),
    text: stripRichText(deepPick(post, ['postContent', 'previewText', 'content', 'text'])),
    images,
    viewCount: Number(deepPick(post, ['viewCount', 'view']) || 0),
    likeCount: Number(deepPick(post, ['likeCount', 'like']) || 0),
    commentCount: Number(deepPick(post, ['commentCount', 'comment']) || 0),
    time: Number.isFinite(time) ? (time > 0 && time < 10000000000 ? time * 1000 : time) : 0,
    userId: String(deepPick(user, ['userId', 'id']) || deepPick(post, ['userId']) || '').trim(),
    name: userName,
    avatar: avatarUrl,
  };
}

/**
 * 归一化评论响应。
 * 返回评论列表 + 用户表（评论的昵称/头像挂在 commentUserList 上，按 userId 关联）。
 */
export function normalizeCommunityComments(content: any): {
  comments: CommunityComment[];
  next: number;
} {
  const list = Array.isArray(content?.commentList) ? content.commentList : [];
  const userMap: Record<string, any> = {};
  (Array.isArray(content?.commentUserList) ? content.commentUserList : []).forEach((u: any) => {
    const id = String(deepPick(u, ['userId', 'id']) || '');
    if (id) userMap[id] = u;
  });

  const comments: CommunityComment[] = list.map((c: any) => {
    const uid = String(deepPick(c, ['userId']) || '');
    const user = userMap[uid] || {};
    const time = Number(deepPick(c, ['ctime', 'createAt', 'time']) || 0);
    return {
      commentId: String(deepPick(c, ['commentId', 'resourceId']) || '').trim(),
      userId: uid,
      name: String(
        deepPick(user, ['realNickName', 'nickName', 'nickname', 'name', 'userName'])
        || deepPick(c, ['realNickName', 'nickName', 'nickname', 'name'])
        || '用户',
      ).trim(),
      avatar: toUrl(
        deepPick(user, ['avatar', 'avatarPath', 'headImg', 'headImgUrl', 'headUrl', 'picUrl', 'picPath', 'icon'])
        || deepPick(c, ['avatar', 'avatarPath', 'headImg', 'headImgUrl', 'headUrl', 'picUrl', 'picPath', 'icon'])
      ),
      text: stripRichText(deepPick(c, ['msg', 'comment', 'content'])),
      time: Number.isFinite(time) ? (time > 0 && time < 10000000000 ? time * 1000 : time) : 0,
    };
  });

  return { comments, next: Number(content?.next || 0) };
}

/**
 * 屏蔽词校验：命中返回命中词列表（去重、最多 100 个）。
 * 词库拉取失败时 fail-open 返回空数组（不阻断发言，避免词库接口抖动卡死用户操作）。
 */
export async function checkMaskWords(text: string): Promise<string[]> {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  try {
    const res = await pocketApi.getPocketMaskWords(0);
    const words = Array.isArray(res?.content?.words) ? res.content.words : [];
    const lower = trimmed.toLowerCase();
    const hits: string[] = [];
    const seen = new Set<string>();
    for (const w of words) {
      const word = String(w || '').trim();
      if (!word || seen.has(word)) continue;
      if (lower.includes(word.toLowerCase())) {
        seen.add(word);
        hits.push(word);
        if (hits.length >= 100) break;
      }
    }
    return hits;
  } catch {
    return [];
  }
}
