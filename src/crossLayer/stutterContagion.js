// src/crossLayer/stutterContagion.js — Cross-layer stutter infection via ATG.
// When one layer stutters, the other layer picks up a complementary stutter
// at the same ms-derived tick with decaying intensity.

/**
 * @typedef {{
 *   intensity: number,
 *   channels: number[],
 *   type: string
 * }} ContagionPayload
 */

StutterContagion = (() => {
  const V = Validator.create('StutterContagion');
  const SYNC_TOLERANCE_MS = 150;
  const DECAY_FACTOR = 0.6;
  const CHANNEL = 'stutterContagion';

  /**
   * Post a stutter event from the active layer into ATG.
   * Call this after any stutter fires in the main loop.
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} intensity - 0-1 normalized stutter intensity
   * @param {number[]} channels - MIDI channels that stuttered
   * @param {string} type - 'fade' | 'pan' | 'fx'
   */
  function postStutter(absTimeMs, layer, intensity, channels, type) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, {
      intensity: clamp(intensity, 0, 1),
      channels,
      type
    });
  }

  /**
   * Check for cross-layer stutter infection. Returns null if no infection
   * should happen, otherwise returns the contagion parameters.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @returns {{ syncTick: number, intensity: number, channels: number[], type: string } | null}
   */
  function checkContagion(absTimeMs, activeLayer) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    const match = AbsoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, SYNC_TOLERANCE_MS, activeLayer
    );
    if (!match) return null;

    const decayedIntensity = match.intensity * DECAY_FACTOR;
    if (decayedIntensity < 0.05) return null;

    // Convert the source stutter's ms to this layer's tick space
    V.requireFinite(measureStart, 'measureStart');
    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(tpSec, 'tpSec');
    const syncTick = Math.round(measureStart + ((match.timeMs / 1000) - measureStartTime) * tpSec);

    return {
      syncTick,
      intensity: decayedIntensity,
      channels: match.channels || [],
      type: match.type || 'fade'
    };
  }

  /**
   * Apply stutter contagion: triggers a secondary stutter on the receiving layer.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   */
  function apply(absTimeMs, activeLayer) {
    const contagion = checkContagion(absTimeMs, activeLayer);
    if (!contagion) return;

    // Scale stutter parameters by decayed intensity
    const numStutters = Math.max(5, Math.round(ri(10, 70) * contagion.intensity));
    const duration = tpSec * rf(.1, .8) * contagion.intensity;

    if (contagion.type === 'fade' && typeof stutterFade === 'function') {
      stutterFade(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    } else if (contagion.type === 'pan' && typeof stutterPan === 'function') {
      stutterPan(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    } else if (contagion.type === 'fx' && typeof stutterFX === 'function') {
      stutterFX(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    }

    // Re-post with decayed intensity to sustain the chain across more layers
    AbsoluteTimeGrid.post(CHANNEL, activeLayer, absTimeMs, {
      intensity: contagion.intensity * DECAY_FACTOR,
      channels: contagion.channels,
      type: contagion.type
    });
  }

  return { postStutter, checkContagion, apply };
})();
