'use strict';

const { findBlockedTerm, normalize } = require('../server/lib/moderation');

describe('normalize', () => {
  test('lowercases, strips accents, maps look-alikes and caps repeats at two', () => {
    expect(normalize('FÜCK')).toBe('fuck');
    expect(normalize('$h1t')).toBe('shit');
    expect(normalize('@ss')).toBe('ass');
    expect(normalize('f4gg0t')).toBe('faggot');
    expect(normalize('fuuuuuck')).toBe('fuuck');
  });
});

describe('findBlockedTerm', () => {
  test('blocks whole words, case and accent insensitive', () => {
    expect(findBlockedTerm('You are a Bitch')).toBe('bitch');
    expect(findBlockedTerm('FÚCK this')).toBe('fuck');
    expect(findBlockedTerm('shits')).toBe('shit');
  });

  test('blocks substitutions and stretched letters', () => {
    expect(findBlockedTerm('5h1t')).toBe('shit');
    expect(findBlockedTerm('fuuuuck')).toBe('fuck');
    expect(findBlockedTerm('b1tch')).toBe('bitch');
  });

  test('blocks letters separated by dots, dashes or spaces', () => {
    expect(findBlockedTerm('f.u.c.k')).toBe('fuck');
    expect(findBlockedTerm('s-h-i-t')).toBe('shit');
    expect(findBlockedTerm('c u n t')).toBe('cunt');
  });

  test('lets innocent words through (the Scunthorpe problem)', () => {
    for (const text of [
      'Scunthorpe', 'assessment', 'classic', 'Sussex', 'therapist', 'Cockburn', 'Dickens',
      'Penistone', 'Hancock', 'raccoon', 'Passover', 'as', 'Hello world', "Zoë O'Neil", 'Room A B C',
    ]) {
      expect(findBlockedTerm(text)).toBeNull();
    }
  });

  test('handles empty and missing text', () => {
    expect(findBlockedTerm('')).toBeNull();
    expect(findBlockedTerm(undefined)).toBeNull();
  });
});
