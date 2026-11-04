/**
 * 房间消息刷新策略。
 *
 * 需求：停在房间页面时消息列表**一直在刷新**（像群聊一样，新消息自己冒出来），
 * 不采用「有推送就降频」的策略 —— 云信圈组推送仍保留（到了先上屏），
 * HTTP 刷新作为持续兜底，保证任何情况下列表都在动。
 */

/** 房间页可见（前台 + 页面聚焦）时的固定刷新间隔。 */
export const ROOM_POLL_INTERVAL_MS = 2_000;
/** 刷新只取最新一小页：新消息通常只有几条，没必要每轮拉 100 条。 */
export const ROOM_REFRESH_LIMIT = 20;
/** 这么久没收到本频道推送，就补订一次频道（长连接可能已被回收）。 */
export const ROOM_REJOIN_AFTER_MS = 60_000;

/** 判断「是否贴着最新消息」的滚动门槛（inverted 列表 offset 0 = 最新）。 */
export const ROOM_AT_BOTTOM_OFFSET = 60;

/**
 * 冻结锚点切分（QQ 式「你翻历史，新消息等着你」）。
 *
 * 上划离开底部时记下当时最新那条消息的 id 当锚点：
 *  - 锚点**之前**（更新）的消息暂不显示，只统计条数；
 *  - 锚点**及其之后**（更旧，含上滑新加载的历史）照常显示。
 *
 * 这样既不会被新消息把视口拽回底部，也不会把「加载更多」拉到的历史挡在外面。
 * 锚点找不到（切房/过滤变化/消息被删）时返回原列表，宁可滚一下也不卡在旧数据。
 */
export function splitByFreezeAnchor<T extends { _id: string }>(
  messages: T[],
  anchorKey: string | null,
): { list: T[]; pending: number } {
  if (!anchorKey) return { list: messages, pending: 0 };
  const index = messages.findIndex((item) => item._id === anchorKey);
  if (index <= 0) return { list: messages, pending: 0 };
  return { list: messages.slice(index), pending: index };
}
