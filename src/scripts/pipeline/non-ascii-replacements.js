'use strict';
/**
 * Shared non-ASCII -> ASCII replacement table.
 *
 * Single source of truth for both the lint-time fixer (fix-non-ascii.js) and
 * the proxy SSE stripper (tools/HME/proxy/sse_ascii_strip_rewriter.js). Add a
 * mapping here once and every consumer picks it up.
 *
 * Keys use \u escapes so this file stays ASCII-clean (the no-non-ascii lint
 * rule forbids literal non-ASCII in source).
 */

// Known non-ASCII -> ASCII equivalents.
const REPLACEMENTS = [
  ['\u2014', '--'],  // em dash
  ['\u2013', '-'],  // en dash
  ['\u2018', '\''],  // left single quotation mark
  ['\u2019', '\''],  // right single quotation mark
  ['\u201C', '"'],  // left double quotation mark
  ['\u201D', '"'],  // right double quotation mark
  ['\u2026', '...'],  // horizontal ellipsis
  ['\u2192', '->'],  // rightwards arrow
  ['\u2190', '<-'],  // leftwards arrow
  ['\u21D2', '=>'],  // rightwards double arrow
  ['\u2260', '!='],  // not equal to
  ['\u2264', '<='],  // less-than or equal to
  ['\u2265', '>='],  // greater-than or equal to
  ['\u2248', '~='],  // almost equal to (approximately)
  ['\u00D7', '*'],  // multiplication sign
  ['\u00B7', '.'],  // middle dot
  ['\u00B1', '+/-'],  // plus-minus sign
  ['\u00B0', 'deg'],  // degree sign
  ['\u03B1', 'alpha'],  // greek small alpha
  ['\u03B2', 'beta'],  // greek small beta
  ['\u03B3', 'gamma'],  // greek small gamma
  ['\u03B4', 'delta'],  // greek small delta
  ['\u03B5', 'epsilon'],  // greek small epsilon
  ['\u03C0', 'pi'],  // greek small pi
  ['\u03C3', 'sigma'],  // greek small sigma
  ['\u03C9', 'omega'],  // greek small omega
  ['\u00A0', ' '],  // non-breaking space
  ['\u200B', ''],  // zero-width space
  ['\u2002', ' '],  // en space
  ['\u2003', ' '],  // em space
  ['\u2009', ' '],  // thin space
  ['\u200A', ' '],  // hair space
  ['\u202F', ' '],  // narrow no-break space
  ['\u2012', '-'],  // figure dash
  ['\u2015', '--'],  // horizontal bar
  ['\u2022', '*'],  // bullet
  ['\u00AD', ''],  // soft hyphen
  ['\u2060', ''],  // word joiner
  ['\uFEFF', ''],  // BOM / zero-width no-break space
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
