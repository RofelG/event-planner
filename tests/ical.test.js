'use strict';

const { buildEventCalendar, escapeText, foldLine, formatUtc, safeFilename } = require('../server/lib/ical');

describe('escapeText', () => {
  test('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
  });
});

describe('formatUtc', () => {
  test('formats as UTC basic format, converting offsets', () => {
    expect(formatUtc('2026-03-05T09:30:00.000Z')).toBe('20260305T093000Z');
    expect(formatUtc('2026-03-05T09:30:00+02:00')).toBe('20260305T073000Z');
    expect(formatUtc(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('20261231T235959Z');
  });
  test('rejects invalid dates', () => {
    expect(() => formatUtc('nope')).toThrow(TypeError);
  });
});

describe('foldLine', () => {
  const octets = (s) => Buffer.byteLength(s, 'utf8');

  test('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  test('folds ASCII at 75 octets with a leading space on continuations', () => {
    const parts = foldLine('x'.repeat(200)).split('\r\n');
    expect(parts.every((p) => octets(p) <= 75)).toBe(true);
    expect(parts[0]).toHaveLength(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe('x'.repeat(200));
  });

  test('never splits a multi-byte character at the boundary', () => {
    // 74 ASCII bytes then a 3-byte character: it must move to the next line whole.
    const line = 'a'.repeat(74) + '€' + 'b'.repeat(10);
    const parts = foldLine(line).split('\r\n');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('a'.repeat(74));
    expect(parts[1]).toBe(' €' + 'b'.repeat(10));
    expect(parts.every((p) => octets(p) <= 75)).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });

  test('keeps astral characters (4 bytes) intact', () => {
    const line = '😀'.repeat(40);
    const parts = foldLine(line).split('\r\n');
    expect(parts.every((p) => octets(p) <= 75)).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });
});

describe('safeFilename', () => {
  test('is ASCII with no quotes or path characters', () => {
    expect(safeFilename('Summer "Party" / ../2026\\x')).toBe('Summer-Party-2026-x.ics');
    expect(safeFilename('Café Ünï')).toBe('Cafe-Uni.ics');
    expect(safeFilename('日本語')).toBe('event.ics');
  });
});

describe('buildEventCalendar', () => {
  const event = {
    id: 7,
    name: 'Launch, Party; "Big"',
    description: 'Line one\nLine two',
    location: 'Hall A',
    start: '2026-03-05T09:30:00.000Z',
    end: '2026-03-05T11:00:00.000Z',
  };
  const out = buildEventCalendar(event, new Date('2026-01-01T00:00:00Z'));

  test('has the required structure with CRLF endings', () => {
    expect(out.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(out.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const l of ['CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'UID:event-7@event-planner', 'DTSTAMP:20260101T000000Z', 'DTSTART:20260305T093000Z', 'DTEND:20260305T110000Z']) {
      expect(out).toContain(`${l}\r\n`);
    }
  });

  test('escapes text values', () => {
    expect(out).toContain('SUMMARY:Launch\\, Party\\; "Big"\r\n');
    expect(out).toContain('DESCRIPTION:Line one\\nLine two\r\n');
  });

  test('omits DESCRIPTION when empty', () => {
    expect(buildEventCalendar({ ...event, description: '' })).not.toContain('DESCRIPTION');
  });
});
