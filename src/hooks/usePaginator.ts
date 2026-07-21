import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 串行化翻页 Hook。
 *
 * 解决的问题：RN 的 onEndReached 在快速滑动时会连续触发多次，
 * 若只靠 `setLoading(true)` 这类「状态锁」，由于 setState 是异步的，
 * 在 loading 真正生效前会发出大量重复请求，导致：
 *   1) 重复追加数据（列表出现重复项）
 *   2) cursor 漂移（多次请求共用同一个旧 cursor，服务端被限流）
 *
 * 这里用 loadingRef（同步、立刻生效）挡住重入，再用 runId
 * 串行化所有翻页/重置调用，丢弃过期响应，保证「返回不回弹」。
 */
export interface PageResult<T> {
  items: T[];
  nextCursor: number;
  hasMore: boolean;
}

export interface UsePaginatorOptions<T> {
  /** 拉取一页。cursor 为上一页返回的 nextCursor（reset 时为 initialCursor）。 */
  fetchPage: (cursor: number) => Promise<PageResult<T>>;
  /** 初始 cursor，默认 0。 */
  initialCursor?: number;
  /** 合并策略，默认 append。 */
  merge?: (prev: T[], next: T[]) => T[];
}

export function usePaginator<T>(options: UsePaginatorOptions<T>) {
  const { fetchPage, initialCursor = 0, merge } = options;

  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const cursorRef = useRef(initialCursor);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);
  const runIdRef = useRef(0); // 单调递增，用于丢弃过期响应

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      // 重入保护：同步生效，避免 onEndReached 连发导致的重复请求
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);

      const runId = ++runIdRef.current;
      const cursor = reset ? initialCursor : cursorRef.current;

      try {
        const res = await fetchPage(cursor);
        // 组件已卸载或已有更新的请求 —— 丢弃过期响应（保证返回不回弹）
        if (!mountedRef.current || runId !== runIdRef.current) return;

        setItems((prev) => {
          const next = reset
            ? res.items
            : merge
            ? merge(prev, res.items)
            : [...prev, ...res.items];
          return next;
        });
        cursorRef.current = res.nextCursor;
        setHasMore(res.hasMore);
      } catch {
        // 错误由调用方在 fetchPage 内处理，这里仅保证不卡死
      } finally {
        if (runId === runIdRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [fetchPage, initialCursor, merge],
  );

  const refresh = useCallback(() => load(true), [load]);
  const loadMore = useCallback(() => {
    if (hasMore && !loadingRef.current) load(false);
  }, [hasMore, load]);

  return { items, loading, hasMore, refresh, loadMore, setItems, loadingRef };
}
