const m = Math;

/**
 * Format seconds as MM:SS.ssss time string.
 * @param {number} seconds - Time in seconds.
 * @returns {string} Formatted time string (MM:SS.ssss).
 */
const formatTime = (seconds) => {
  const minutes = m.floor(seconds / 60);
  seconds = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};

try { module.exports = formatTime; } catch (e) { /* swallow */ }
try { Function('f', 'this.formatTime = f')(formatTime); } catch (e) { /* swallow */ }
