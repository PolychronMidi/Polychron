// src/rhythm/patternLength.js - extracted from src/rhythm.js
module.exports.patternLength = function patternLength(pattern, length) {
  if (__POLYCHRON_TEST__?.enableLogging) console.log('[patternLength] START', pattern.length, length);
  if (length === undefined) {
    if (__POLYCHRON_TEST__?.enableLogging) console.log('[patternLength] END');
    return pattern;
  }
  if (pattern.length === 0) {
    if (__POLYCHRON_TEST__?.enableLogging) console.log('[patternLength] END');
    return pattern; // Can't extend empty pattern
  }
  if (length > pattern.length) {
    while (pattern.length < length) { pattern = pattern.concat(pattern.slice(0, length - pattern.length)); }
    if (__POLYCHRON_TEST__?.enableLogging) console.log('[patternLength] extended to', pattern.length);
  } else if (length < pattern.length) {
    pattern = pattern.slice(0, length);
    if (__POLYCHRON_TEST__?.enableLogging) console.log('[patternLength] truncated to', pattern.length);
  }
  if (__POLYCHRON_TEST__?.enableLogging) console.log('[patternLength] END');
  return pattern;
};
