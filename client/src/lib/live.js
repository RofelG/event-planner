// One shared connection to the live catalogue stream (Server-Sent Events) for
// the whole app. Components subscribe with useLiveEvents; the connection opens
// with the first subscriber and closes with the last (for example on sign-out).
//
// Messages: { type: 'event', data: event } and { type: 'remove', data: { id } },
// plus { type: 'reconnected' } after a dropped connection comes back, so
// subscribers can reload anything they may have missed.

import { api } from './api';

const listeners = new Set();
const statusListeners = new Set();
let source = null;
let status = 'offline'; // 'connecting' | 'live' | 'offline'
let hasConnected = false;
let retryTimer = null;

function setStatus(next) {
  status = next;
  statusListeners.forEach((fn) => fn(next));
}

function dispatch(message) {
  listeners.forEach((fn) => fn(message));
}

function open() {
  clearTimeout(retryTimer);
  setStatus('connecting');
  source = new EventSource('/api/events/stream');

  source.addEventListener('ready', () => {
    if (hasConnected) dispatch({ type: 'reconnected' });
    hasConnected = true;
    setStatus('live');
  });
  for (const type of ['event', 'remove']) {
    source.addEventListener(type, (e) => dispatch({ type, data: JSON.parse(e.data) }));
  }
  source.onerror = () => {
    // EventSource retries dropped connections itself. It gives up (CLOSED)
    // when the server refuses, for example on an expired session; then try
    // again later, and let the API's 401 handling sign the user out.
    if (source.readyState === EventSource.CLOSED) {
      setStatus('offline');
      source = null;
      // An ordinary API call: if the session expired, its 401 triggers the
      // app-wide sign-out (see lib/api.js) and the subscribers unmount.
      api('/types').catch(() => {});
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (listeners.size) open();
      }, 10000);
    } else {
      setStatus('connecting');
    }
  };
}

function close() {
  clearTimeout(retryTimer);
  retryTimer = null;
  source?.close();
  source = null;
  hasConnected = false;
  setStatus('offline');
}

export function subscribe(listener) {
  listeners.add(listener);
  if (!source && !retryTimer) open();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) close();
  };
}

/**
 * Sends a change made in this tab to subscribers straight away (for example
 * after saving in the event editor), without waiting for the server's copy.
 * Applying the same event twice is harmless.
 */
export function publishLocal(message) {
  dispatch(message);
}

export function getStatus() {
  return status;
}

export function onStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
