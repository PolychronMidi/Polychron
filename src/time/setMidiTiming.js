/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 * @param {number} [tick] - MIDI tick position.
 */
setMidiTiming = (tick) => {

  // Debug: always log minimal buffer state to help triage why events are not appearing in tests
  try { console.log('setMidiTiming-debug-start', { cType: Object.prototype.toString.call(c), isArray: Array.isArray(c), cLen: Array.isArray(c) ? c.length : (c && Array.isArray(c.rows) ? c.rows.length : null), pType: typeof p }); } catch (_e) { /* swallow */ }

  if (typeof tick === 'undefined') tick = measureStart;

  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec: ${tpSec}`);
  }
  // Defensive: ensure midiMeter is defined before accessing indices
  if (!Array.isArray(midiMeter) || midiMeter.length < 2) {
    const defaultNumerator = (typeof numerator !== 'undefined' && Number.isFinite(Number(numerator))) ? Number(numerator) : 4;
    const defaultDenominator = (typeof denominator !== 'undefined' && Number.isFinite(Number(denominator))) ? Number(denominator) : 4;
    midiMeter = [defaultNumerator, defaultDenominator];
  }
  // If `p` (push helper) isn't available or has been overridden in tests,
  // write directly to the buffer for robustness in unit tests.
  try {
    if (typeof p !== 'function') {
      if (Array.isArray(c) || (c && typeof c.push === 'function')) {
        c.push({ tick: tick, type: 'bpm', vals: [midiBPM] });
        c.push({ tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] });
        return;
      }
    }
  } catch (_e) { /* swallow */ }

  p(c,
    { tick: tick, type: 'bpm', vals: [midiBPM] },
    { tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] },
  );
};

// Export for programmatic use
try { module.exports = setMidiTiming; } catch (e) { /* swallow export errors */ }
