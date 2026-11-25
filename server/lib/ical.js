'use strict';

/**
 * Minimal single-event iCalendar (RFC 5545) writer. Hand-rolled because one
 * VEVENT does not justify a dependency.
 */

const CRLF = '\r\n';
const MAX_OCTETS = 75;

/** Escapes a TEXT value (RFC 5545 3.3.11); line breaks of any style become \n. */
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    // Other control characters are not allowed in TEXT.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Date or ISO string to UTC basic format, e.g. 20260131T093000Z. */
function formatUtc(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new TypeError('Invalid date');
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Folds a content line so no line exceeds 75 octets (CRLF excluded). The limit
 * is in UTF-8 bytes, so we walk code points and never split one. Continuation
 * lines begin with a single space, which counts toward their 75.
 */
function foldLine(line) {
  const lines = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch, 'utf8');
    if (size + bytes > MAX_OCTETS) {
      lines.push(current);
      current = ' ';
      size = 1;
    }
    current += ch;
    size += bytes;
  }
  lines.push(current);
  return lines.join(CRLF);
}

/** Builds the .ics body for one event ({ id, name, description, location, start, end }). */
function buildEventCalendar(event, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Event Planner//Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${event.id}@event-planner`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeText(event.name)}`,
    `LOCATION:${escapeText(event.location)}`,
  ];
  // An empty DESCRIPTION is legal but noise; omit it.
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** ASCII-only filename from an event name: no quotes, slashes or other header-hostile characters. */
function safeFilename(name) {
  const base = String(name ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base || 'event'}.ics`;
}

module.exports = { buildEventCalendar, escapeText, foldLine, formatUtc, safeFilename };
