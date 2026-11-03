/**
 * 房间消息「实时」策略。
 *
 * 主通道是云信圈组（QChat）长连接：正常时消息由原生推送直接上屏，HTTP 轮询只是兜底。
 * 但长连接会在多种情况下静默失效（未登录成功、订阅被服务端回收、切网/后台回来），
 * 此前兜底轮询固定 60s，用户看到的就是「消息不实时 / 要切房间才刷新」。
 *
 * 这里按「最近有没有收到本频道推送」判断长连接是否还活着：
 *  - 45s 内收到过推送 → 认为实时通道正常，轮询降到 60s（省电）
 *  - 否则 → 8s 快速轮询兜底（观感接近实时）
 */

/** 超过这个时间没有任何推送，就认为长连接已经静默。 */
export const ROOM_PUSH_ALIVE_MS = 45_000;
/** 长连接正常时的兜底轮询间隔。 */
export const ROOM_POLL_SLOW_MS = 60_000;
/** 长连接静默时的快速轮询间隔。 */
export const ROOM_POLL_FAST_MS = 8_000;
/** 实时刷新只取最新一小页：新消息通常只有几条，没必要每轮拉 100 条。 */
export const ROOM_REFRESH_LIMIT = 20;

export function roomPollDelay(now: number, lastPushAt: number): number {
  if (!lastPushAt) return ROOM_POLL_FAST_MS;
  return now - lastPushAt < ROOM_PUSH_ALIVE_MS ? ROOM_POLL_SLOW_MS : ROOM_POLL_FAST_MS;
}
