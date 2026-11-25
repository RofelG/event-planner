import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export const PAGE_SIZE = 18; // six rows of three cards

const toQuery = ({ typeId, q, mine }, limit, cursor) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (typeId) params.set('type', typeId);
  if (q) params.set('q', q);
  if (mine) params.set('mine', 'true');
  if (cursor) params.set('cursor', cursor);
  return `/events?${params}`;
};

/**
 * The catalogue, loaded a page at a time (GET /api/events?limit=&cursor=).
 *
 * - Changing filters loads a fresh first page; the old list stays on screen
 *   until it arrives, then `dataKey` changes (so the grid can replay its entrance).
 * - loadMore() appends the next page; `hasMore` is false at the end.
 * - reload() refetches as many events as are loaded now, so a reconnect does
 *   not throw away how far the user has scrolled.
 * - setItems() lets live updates edit the loaded list in place.
 */
export function usePagedEvents(filters) {
  const key = JSON.stringify(filters);
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [dataKey, setDataKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  // Index of the first card of the most recent page, so only new cards stagger.
  const [pageStart, setPageStart] = useState(0);
  const request = useRef(null);
  const countRef = useRef(0);
  countRef.current = items?.length || 0;

  /** Loads at least `want` events from the start (one or more pages). */
  const loadFirst = useCallback(
    async (want = PAGE_SIZE) => {
      request.current?.abort();
      const ctrl = new AbortController();
      request.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const parsed = JSON.parse(key);
        const collected = [];
        let next = null;
        do {
          const page = await api(toQuery(parsed, Math.min(50, Math.max(PAGE_SIZE, want - collected.length)), next), { signal: ctrl.signal });
          collected.push(...page.items);
          next = page.nextCursor;
        } while (next && collected.length < want);
        if (ctrl.signal.aborted) return;
        setItems(collected);
        setCursor(next);
        setDataKey(key);
        setPageStart(0);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [key]
  );

  useEffect(() => {
    loadFirst();
    return () => request.current?.abort();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const page = await api(toQuery(JSON.parse(key), PAGE_SIZE, cursor));
      // Ignore a page that arrives after the filters changed.
      if (key !== dataKey) return;
      setPageStart(countRef.current);
      setItems((list) => {
        const seen = new Set(list.map((e) => e.id));
        return [...list, ...page.items.filter((e) => !seen.has(e.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, loading, key, dataKey]);

  const reload = useCallback(() => loadFirst(Math.max(PAGE_SIZE, countRef.current)), [loadFirst]);

  return { items, setItems, hasMore: Boolean(cursor), loading, loadingMore, error, dataKey, pageStart, loadMore, reload };
}
