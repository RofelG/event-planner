'use strict';

/**
 * Opaque page cursors for the catalogue: the (start, id) position of the last
 * event read, base64url-encoded. Clients pass it back unchanged for the next page.
 */

const START = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** event.start is ISO (2026-12-01T18:00:00Z); the database compares 'YYYY-MM-DD HH:MM:SS'. */
function positionOf(event) {
  return { start: event.start.replace('T', ' ').replace(/(\.\d+)?Z$/, ''), id: event.id };
}

function encodeCursor({ start, id }) {
  return Buffer.from(JSON.stringify({ s: start, i: id })).toString('base64url');
}

/** Returns { start, id }, or null if the cursor is malformed. */
function decodeCursor(value) {
  try {
    const { s, i } = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof s !== 'string' || !START.test(s) || !Number.isInteger(i) || i < 1) return null;
    return { start: s, id: i };
  } catch {
    return null;
  }
}

module.exports = { positionOf, encodeCursor, decodeCursor };
