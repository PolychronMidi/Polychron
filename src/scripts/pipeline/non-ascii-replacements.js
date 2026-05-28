'use strict';
/**
 * Shared non-ASCII -> ASCII replacement table.
 *
 * Single source of truth for both the lint-time fixer
 * (fix-non-ascii.js) and the proxy SSE stripper
 * (tools/HME/proxy/sse_ascii_strip_rewriter.js). Add a mapping here once and
 * every consumer picks it up.
 */

// Known non-ASCII -> ASCII equivalents.
const REPLACEMENTS = [
  ['—', '--'],         // em dash
  ['–', '-'],          // en dash
  ['‘', "'"],          // left single quotation mark
  ['’', "'"],          // right single quotation mark
  ['“', '"'],          // left double quotation mark
  ['”', '"'],          // right double quotation mark
  ['…', '...'],        // horizontal ellipsis
  ['→', '->'],         // rightwards arrow
  ['←', '<-'],         // leftwards arrow
  ['⇒', '=>'],         // rightwards double arrow
  ['≠', '!='],         // not equal to
  ['≤', '<='],         // less-than or equal to
  ['≥', '>='],         // greater-than or equal to
  ['≈', '~='],         // almost equal to (approximately)
  ['×', '*'],          // multiplication sign
  ['·', '.'],          // middle dot
  ['±', '+/-'],        // plus-minus sign
  ['°', 'deg'],        // degree sign
  ['α', 'alpha'],      // greek small alpha
  ['β', 'beta'],       // greek small beta
  ['γ', 'gamma'],      // greek small gamma
  ['δ', 'delta'],      // greek small delta
  ['ε', 'epsilon'],    // greek small epsilon
  ['π', 'pi'],         // greek small pi
  ['σ', 'sigma'],      // greek small sigma
  ['ω', 'omega'],      // greek small omega
  [' ', ' '],          // non-breaking space
  ['​', ''],           // zero-width space
  ['﻿', ''],           // BOM / zero-width no-break space
];

const _MAP = new Map(REPLACEMENTS);

// Replace every known non-ASCII char with its ASCII equivalent. Characters
// without a mapping are left in place (callers decide how to treat residue).
function normalizeToAscii(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = '';
  for (const ch of text) {
    out += _MAP.has(ch) ? _MAP.get(ch) : ch;
  }
  return out;
}

module.exports = { REPLACEMENTS, normalizeToAscii };
