import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getStatus, onStatus, subscribe } from '../lib/live';

/**
 * Calls `handler` for each live catalogue message while the component is
 * mounted. The latest handler is always used, so it can close over state.
 */
export function useLiveEvents(handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe((message) => latest.current(message)), []);
}

/** 'connecting' | 'live' | 'offline' */
export function useLiveStatus() {
  return useSyncExternalStore(onStatus, getStatus);
}
