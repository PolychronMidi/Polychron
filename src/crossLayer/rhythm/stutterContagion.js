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
  const V = validator.create('stutterContagion');
  const STUTTER_TYPES = new Set(['fade', 'pan', 'fx']);
  const SYNC_TOLERANCE_MS = 150;
  const BASE_DECAY = 0.6;
  const ALIGNED_DECAY = 0.35; // tighter decay = stickier when converged
  const DIVERGED_DECAY = 0.8;  // looser decay = fades faster when divergent
  const CONVERGENCE_WINDOW_MS = 2000; // look for recent convergences within this window
  const CHANNEL = 'stutterContagion';

  /**
   * Compute adaptive decay factor based on recent convergence state.
   * @param {number} absTimeMs
   * @returns {number} decay factor (lower = stickier)
   */
  function getAdaptiveDecay(absTimeMs) {
    // Check if convergence happened recently via ATG onset channel
    const recentConvergence = AbsoluteTimeGrid.findClosest(
      'onset', absTimeMs, CONVERGENCE_WINDOW_MS
    );
    if (!recentConvergence) return BASE_DECAY;
    const dist = Math.abs(recentConvergence.timeMs - absTimeMs);
    const recency = 1 - (dist / CONVERGENCE_WINDOW_MS);
    // Interpolate: recent convergence → ALIGNED (sticky), distant → DIVERGED (loose)
    return BASE_DECAY + recency * (ALIGNED_DECAY - BASE_DECAY) + (1 - recency) * (DIVERGED_DECAY - BASE_DECAY) * 0.3;
  }

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
    V.assertNonEmptyString(layer, 'layer');
    const normalizedIntensity = clamp(V.requireFinite(intensity, 'intensity'), 0, 1);
    const normalizedChannels = V.assertArray(channels, 'channels');
    for (let i = 0; i < normalizedChannels.length; i++) {
      V.requireFinite(normalizedChannels[i], `channels[${i}]`);
    }
    const normalizedType = V.assertInSet(type, STUTTER_TYPES, 'type');
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, {
      intensity: normalizedIntensity,
      channels: normalizedChannels,
      type: normalizedType
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
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const match = AbsoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, SYNC_TOLERANCE_MS, activeLayer
    );
    if (!match) return null;
    V.assertObject(match, 'checkContagion.match');
    const matchIntensity = V.requireFinite(match.intensity, 'checkContagion.match.intensity');
    const matchTimeMs = V.requireFinite(match.timeMs, 'checkContagion.match.timeMs');
    const matchChannels = V.assertArray(match.channels, 'checkContagion.match.channels');
    for (let i = 0; i < matchChannels.length; i++) {
      V.requireFinite(matchChannels[i], `checkContagion.match.channels[${i}]`);
    }
    const matchType = V.assertInSet(match.type, STUTTER_TYPES, 'checkContagion.match.type');

    const decay = getAdaptiveDecay(absTimeMs);
    const decayedIntensity = matchIntensity * decay;
    if (decayedIntensity < 0.05) return null;

    // Convert the source stutter's ms to this layer's tick space
    V.requireFinite(measureStart, 'measureStart');
    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(tpSec, 'tpSec');
    const syncTickRaw = Math.round(measureStart + ((matchTimeMs / 1000) - measureStartTime) * tpSec);
    const syncTick = Math.max(0, syncTickRaw);

    return {
      syncTick,
      intensity: decayedIntensity,
      channels: matchChannels,
      type: matchType
    };
  }

  /**
   * Apply stutter contagion: triggers a secondary stutter on the receiving layer.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   */
  function apply(absTimeMs, activeLayer) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const contagion = checkContagion(absTimeMs, activeLayer);
    if (!contagion) return;

    // Scale stutter parameters by decayed intensity
    const numStutters = Math.max(5, Math.round(ri(10, 70) * contagion.intensity));
    const duration = tpSec * rf(.1, .8) * contagion.intensity;

    if (contagion.type === 'fade' && stutterFade) {
      stutterFade(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    } else if (contagion.type === 'pan' && stutterPan) {
      stutterPan(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    } else if (contagion.type === 'fx' && stutterFX) {
      stutterFX(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    }

    // Re-post with decayed intensity to sustain the chain across more layers
    const repostDecay = getAdaptiveDecay(absTimeMs);
    AbsoluteTimeGrid.post(CHANNEL, activeLayer, absTimeMs, {
      intensity: contagion.intensity * repostDecay,
      channels: contagion.channels,
      type: contagion.type
    });
  }

  return { postStutter, checkContagion, apply, reset() { /* stateless — no per-scope state to clear */ } };
})();
CrossLayerRegistry.register('StutterContagion', StutterContagion, ['all']);
