// src/crossLayer/convergenceDetector.js — Polyrhythmic convergence detection.
// Posts every note onset to ATG 'onset' channel. When two layers' onsets land
// within a tight ms tolerance, that's a convergence point — triggers special events.

ConvergenceDetector = (() => {
  const V = Validator.create('ConvergenceDetector');
  const CHANNEL = 'onset';
  const CONVERGENCE_TOLERANCE_MS = 25;
  const MIN_CONVERGENCE_INTERVAL_MS = 500;

  let lastConvergenceMs = -Infinity;

  /**
   * Post a note onset from the active layer.
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} midi - MIDI note number
   * @param {number} velocity - 0-127
   */
  function postOnset(absTimeMs, layer, midi, velocity) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, { midi, velocity });
  }

  /**
   * Check whether a convergence just occurred at this time point.
   * Returns null if no convergence, or a convergence descriptor.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @returns {{ syncTick: number, rarity: number, otherMidi: number, otherVelocity: number } | null}
   */
  function detect(absTimeMs, activeLayer) {
    V.requireFinite(absTimeMs, 'absTimeMs');

    // Throttle: don't fire convergence events more often than the interval
    if (absTimeMs - lastConvergenceMs < MIN_CONVERGENCE_INTERVAL_MS) return null;

    const match = AbsoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, CONVERGENCE_TOLERANCE_MS, activeLayer
    );
    if (!match) return null;

    lastConvergenceMs = absTimeMs;

    // Rarity: tighter alignment = higher rarity score (0-1)
    const dist = Math.abs(match.timeMs - absTimeMs);
    const rarity = 1 - (dist / CONVERGENCE_TOLERANCE_MS);

    // Convert to this layer's tick space
    V.requireFinite(measureStart, 'measureStart');
    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(tpSec, 'tpSec');
    const syncTick = Math.round(measureStart + ((match.timeMs / 1000) - measureStartTime) * tpSec);

    return {
      syncTick,
      rarity: clamp(rarity, 0, 1),
      otherMidi: match.midi || 0,
      otherVelocity: match.velocity || 0
    };
  }

  /**
   * Apply convergence effects: accent burst and velocity reinforcement.
   * Call from the main loop after each note emission.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} currentMidi - the note just played
   * @param {number} currentVelocity - the velocity just used
   * @returns {{ convergence: boolean, rarity: number } | null}
   */
  function applyIfConverged(absTimeMs, activeLayer, currentMidi, currentVelocity) {
    const conv = detect(absTimeMs, activeLayer);
    if (!conv) return null;

    // Emit convergence event for conductor/other subsystems to react
    if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') {
      EventBus.emit('CROSS_LAYER_CONVERGENCE', {
        layer: activeLayer,
        rarity: conv.rarity,
        syncTick: conv.syncTick,
        noteA: currentMidi,
        noteB: conv.otherMidi,
        velocityA: currentVelocity,
        velocityB: conv.otherVelocity,
        absTimeMs
      });
    }

    return { convergence: true, rarity: conv.rarity };
  }

  /** Reset state (e.g. between sections). */
  function reset() {
    lastConvergenceMs = -Infinity;
  }

  return { postOnset, detect, applyIfConverged, reset };
})();
