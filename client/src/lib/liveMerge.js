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
 * @param {object} event   Serialized event (name, location, description, type.id, end, ...)
 * @param {object} filters { typeId: number|null, q: string } (q is already trimmed)
 */
export function matchesFilters(event, { typeId, q }) {
  if (typeId && event.type.id !== typeId) return false;
  if (!q) return true;
  // Same fields as the server: name, location or description.
  const needle = fold(q);
  return [event.name, event.location, event.description].some((field) => fold(field).includes(needle));
}

/**
 * Applies one live `event` message to a catalogue list: replaces the event if
 * it is listed, inserts it in start-time order if it is new and matches the
 * filters, and drops it if it no longer matches (for example its type changed).
 */
export function mergeLiveEvent(list, event, filters) {
  const index = list.findIndex((e) => e.id === event.id);
  const belongs = !hasEnded(event) && matchesFilters(event, filters);

  if (index === -1) {
    if (!belongs) return list;
    const next = [...list, event];
    return next.sort((a, b) => new Date(a.start) - new Date(b.start));
  }
  if (!belongs) return list.filter((e) => e.id !== event.id);
  const next = [...list];
  next[index] = event;
  return next;
}
