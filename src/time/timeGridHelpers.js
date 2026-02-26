// timeGridHelpers.js — Shared binary-search utilities for absoluteTimeWindow and absoluteTimeGrid.
// Both modules store time-sorted arrays and need identical prune + search-start logic.

/**
 * Binary-search prune: remove entries older than cutoff, enforce max cap.
 * @param {Array} arr - time-sorted array
 * @param {string} timeField - property name holding the timestamp ('time' or 'timeMs')
 * @param {number} now - current timestamp
 * @param {number} window - retention window (same unit as now)
 * @param {number} maxEntries - hard cap on array length
 */
timeGridPrune = function(arr, timeField, now, window, maxEntries) {
  if (arr.length === 0) return;
  const cutoff = now - window;
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid][timeField] < cutoff) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) arr.splice(0, lo);
  if (arr.length > maxEntries) arr.splice(0, arr.length - maxEntries);
};

/**
 * Binary search for the first array index where entry[timeField] >= cutoff.
 * @param {Array} arr - time-sorted array
 * @param {string} timeField - property name holding the timestamp
 * @param {number} cutoff - lower bound timestamp
 * @returns {number} start index
 */
timeGridSearchStart = function(arr, timeField, cutoff) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid][timeField] < cutoff) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
