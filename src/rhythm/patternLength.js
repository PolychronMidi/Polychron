// src/rhythm/patternLength.js - extracted from src/rhythm.js
patternLength = function patternLength(pattern, length) {
  if (length === undefined) {
    return pattern;
  }
  if (pattern.length === 0) {
    return pattern; // Can't extend empty pattern
  }
  if (length > pattern.length) {
    while (pattern.length < length) { pattern = pattern.concat(pattern.slice(0, length - pattern.length)); }
  } else if (length < pattern.length) {
    pattern = pattern.slice(0, length);
  }
  return pattern;
};
