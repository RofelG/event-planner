'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Word filter for untrusted text (demo guests). It blocks obvious slurs and
 * strong profanity; it is not a complete moderation system.
 */

const SUBSTITUTIONS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

/** Lowercase, strip accents, undo common look-alike characters, cap repeats at two. */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[013457@$]/g, (c) => SUBSTITUTIONS[c])
    .replace(/([a-z])\1{2,}/g, '$1$1');
}

/**
 * A term matches a whole word, allowing its letters to be stretched
 * ("fuuuck" -> "fuuck" after normalizing) and a plural "s". Doubled letters in
 * the term stay doubled, so "ass" would never match "as".
 */
function termPattern(term) {
  const letters = normalize(term).replace(/[^a-z]/g, '');
  const body = letters.replace(/([a-z])\1*/g, (run) => `${run[0]}{${Math.min(run.length, 2)},2}`);
  return { term: letters, regex: new RegExp(`^${body}s?$`) };
}

function loadTerms() {
  const terms = require('./blocked-terms.json');
  const extra = process.env.BLOCKED_TERMS_FILE;
  if (!extra) return terms;
  // Fail at startup rather than silently running with a weaker filter.
  let more;
  try {
    more = JSON.parse(fs.readFileSync(path.resolve(extra), 'utf8'));
  } catch (err) {
    throw new Error(`BLOCKED_TERMS_FILE could not be read as JSON: ${err.message}`);
  }
  if (!Array.isArray(more) || !more.every((t) => typeof t === 'string')) {
    throw new Error('BLOCKED_TERMS_FILE must contain a JSON array of strings');
  }
  return [...terms, ...more];
}

const patterns = loadTerms().map(termPattern).filter((p) => p.term.length > 1);

/** Words in the text, with runs of single letters ("f.u.c.k", "f u c k") joined. */
function words(text) {
  const out = [];
  let run = '';
  const flush = () => {
    if (run) out.push(run);
    run = '';
  };
  for (const token of normalize(text).split(/[^a-z]+/).filter(Boolean)) {
    if (token.length === 1) {
      run += token;
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

/** The blocked term found in the text, or null. Never send the result to a client. */
function findBlockedTerm(text) {
  for (const word of words(text)) {
    const hit = patterns.find((p) => p.regex.test(word));
    if (hit) return hit.term;
  }
  return null;
}

/** Keys of `values` whose text contains a blocked term. */
function blockedFields(values) {
  return Object.keys(values).filter((key) => findBlockedTerm(values[key]));
}

module.exports = { findBlockedTerm, blockedFields, normalize };
