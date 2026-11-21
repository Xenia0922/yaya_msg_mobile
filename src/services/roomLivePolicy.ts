export const ROOM_POLL_INTERVAL_MS = 2_000;

export const ROOM_REFRESH_LIMIT = 20;

export const ROOM_REJOIN_AFTER_MS = 60_000;

export const ROOM_AT_BOTTOM_OFFSET = 60;

export function splitByFreezeAnchor<T extends { _id: string }>(
  messages: T[],
  anchorKey: string | null,
): { list: T[]; pending: number } {
  if (!anchorKey) return { list: messages, pending: 0 };
  const index = messages.findIndex((item) => item._id === anchorKey);
  if (index <= 0) return { list: messages, pending: 0 };
  return { list: messages.slice(index), pending: index };
}
