// timeGridHelpers.js - Binary-search utility for L0 time-sorted arrays.

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
