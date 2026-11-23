export const ROOM_POLL_INTERVAL_MS = 2_000;

export const ROOM_REFRESH_LIMIT = 20;

export const ROOM_REJOIN_AFTER_MS = 60_000;

export const ROOM_AT_BOTTOM_OFFSET = 60;

export const ROOM_SEARCH_DEBOUNCE_MS = 220;

export const ROOM_LOAD_MORE_COOLDOWN_MS = 260;

export const ROOM_SEARCH_MIN_HITS = 12;

export const ROOM_SEARCH_BURST_PAGES = 6;

export interface HistoryCursorAdvance {
  nextTime: number;
  hasMore: boolean;
  stalled: boolean;
}

export function computeHistoryCursorAdvance(
  prevCursor: number,
  nextCursor: number,
  pageCount: number,
  addedCount: number,
): HistoryCursorAdvance {
  if (pageCount <= 0 || !Number.isFinite(nextCursor) || nextCursor <= 0) {
    return { nextTime: 0, hasMore: false, stalled: false };
  }
  if (prevCursor > 0) {
    if (nextCursor > prevCursor) {
      return { nextTime: 0, hasMore: false, stalled: true };
    }
    if (nextCursor === prevCursor) {
      if (addedCount <= 0 || prevCursor <= 1) {
        return { nextTime: 0, hasMore: false, stalled: true };
      }
      return { nextTime: prevCursor - 1, hasMore: true, stalled: false };
    }
  }
  return { nextTime: nextCursor, hasMore: true, stalled: false };
}

export function shouldAutoLoadMoreOnScroll(params: {
  offsetY: number;
  contentHeight: number;
  layoutHeight: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  pausedAtSearchLimit?: boolean;
}): boolean {
  if (!params.hasMore || params.loading || params.loadingMore || params.pausedAtSearchLimit) {
    return false;
  }
  if (params.contentHeight <= 0 || params.layoutHeight <= 0) return false;
  if (params.contentHeight <= params.layoutHeight) return false;
  if (params.offsetY <= 20) return false;
  const remaining = Math.max(0, params.contentHeight - params.layoutHeight - params.offsetY);
  const triggerThreshold = Math.max(360, params.layoutHeight * 0.7);
  return remaining <= triggerThreshold;
}

export function shouldSearchAutoContinue(params: {
  query: string;
  matchCount: number;
  targetMatchCount: number;
  pagesScannedInBurst: number;
  maxPagesPerBurst?: number;
  hasMore: boolean;
  nextTime: number;
}): boolean {
  if (!params.query.trim()) return false;
  if (!params.hasMore || params.nextTime <= 0) return false;
  const maxPages = params.maxPagesPerBurst ?? ROOM_SEARCH_BURST_PAGES;
  if (params.pagesScannedInBurst >= maxPages) return false;
  return params.matchCount < params.targetMatchCount;
}

export function splitByFreezeAnchor<T extends { _id: string }>(
  messages: T[],
  anchorKey: string | null,
): { list: T[]; pending: number } {
  if (!anchorKey) return { list: messages, pending: 0 };
  const index = messages.findIndex((item) => item._id === anchorKey);
  if (index <= 0) return { list: messages, pending: 0 };
  return { list: messages.slice(index), pending: index };
}
