import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * Loads a GET endpoint and tracks loading and error state. Re-fetches when the
 * path changes and aborts stale requests so out-of-order responses are ignored.
 */
export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const controller = useRef(null);

  const load = useCallback(async () => {
    if (!path) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const result = await api(path, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setData(result);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, [load]);

  return { data, setData, error, loading, reload: load };
}
