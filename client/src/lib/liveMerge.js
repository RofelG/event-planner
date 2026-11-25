import { hasEnded } from './format';

/**
 * Lowercases and strips accents, approximating MySQL's default utf8mb4_0900_ai_ci
 * collation (accent- and case-insensitive), which the server's LIKE search uses.
 */
const fold = (text) =>
  (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Whether a live-updated event belongs in the catalogue the user is looking at.
 * Mirrors the server's GET /api/events filters, so the list matches what a
 * fresh load would return.
 *
 * @param {object} event   Serialized event (name, location, description, type.id, isRegistered, ...)
 * @param {object} filters { typeId: number|null, q: string, mine?: boolean } (q is already trimmed)
 */
export function matchesFilters(event, { typeId, q, mine = false }) {
  if (typeId && event.type.id !== typeId) return false;
  if (mine && !event.isRegistered) return false;
  if (!q) return true;
  // Same fields as the server: name, location or description.
  const needle = fold(q);
  return [event.name, event.location, event.description].some((field) => fold(field).includes(needle));
}

/** Catalogue order, the same as the server's: start time, then id. */
const byStartThenId = (a, b) => new Date(a.start) - new Date(b.start) || a.id - b.id;

/**
 * Applies one live `event` message to a catalogue list: replaces the event if
 * it is listed, inserts it in order if it is new and matches the filters, and
 * drops it if it no longer matches (for example its type changed).
 *
 * `complete` is false while more pages remain to be loaded. A new event that
 * sorts after the last loaded one is then left out: it belongs on a page the
 * user has not reached, and will arrive with that page.
 */
export function mergeLiveEvent(list, event, filters, { complete = true } = {}) {
  const index = list.findIndex((e) => e.id === event.id);
  const belongs = !hasEnded(event) && matchesFilters(event, filters);

  if (index === -1) {
    if (!belongs) return list;
    const last = list.at(-1);
    if (!complete && last && byStartThenId(event, last) > 0) return list;
    return [...list, event].sort(byStartThenId);
  }
  if (!belongs) return list.filter((e) => e.id !== event.id);
  const next = [...list];
  next[index] = event;
  return next;
}
