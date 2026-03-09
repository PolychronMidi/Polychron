// src/crossLayer/rhythmicComplementEngine.js - Deliberate rhythmic interlocking.
// Coordinates rhythmic complementarity between layers: hocket (alternating hits),
// antiphony (call-response), and canon (delayed imitation).
// Reads ATW for other layer timing to compute ideal complement positions.

rhythmicComplementEngine = (() => {
  const V = validator.create('rhythmicComplementEngine');

  /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */
  let mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('free');
  const MODE_CHANGE_INTERVAL = 8; // beats between mode re-evaluation

  // Analysis
  const ANALYSIS_WINDOW_S = 2;
  const GAP_THRESHOLD_MS = 200;

  // Strength gating
  const STRENGTH_SCALE = 1.5;
  const STRENGTH_OFFSET = 0.3;
  const STRENGTH_GATE = 0.6;

  // Hocket
  const HOCKET_SHIFT_MIN = 0.3;
  const HOCKET_SHIFT_MAX = 0.7;
  const HOCKET_VEL_BOOST = 0.1;

  // Antiphony
  const ANTIPHONY_DELAY_MIN = 0.08;
  const ANTIPHONY_DELAY_MAX = 0.2;
  const ANTIPHONY_VEL_BASE = 0.85;
  const ANTIPHONY_VEL_SCALE = 0.15;

  // Canon
  const CANON_GROOVE_SCALE = 0.5;
  const CANON_VELOCITY = 0.9;

  // Mode selection thresholds
  const HIGH_INTERACTION = 0.6;
  const LOW_DENSITY = 0.4;
  const HIGH_DENSITY = 0.6;
  const MODERATE_INTERACTION = 0.4;

  let beatsSinceChange = 0;

  /**
   * Analyze the other layer's recent onsets to determine gaps.
   * @param {string} activeLayer
   * @param {number} absTimeMs
   * @returns {{ gaps: number[], density: number, avgIOI: number }}
   */
  function analyzeOtherLayer(activeLayer, absTimeMs) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    const otherLayer = crossLayerHelpers.getOtherLayer(activeLayer);

    const notes = absoluteTimeWindow.getNotes({
      layer: otherLayer,
      since: (absTimeMs / 1000) - ANALYSIS_WINDOW_S,
      windowSeconds: ANALYSIS_WINDOW_S
    });

    if (notes.length < 2) return { gaps: [], density: notes.length / ANALYSIS_WINDOW_S, avgIOI: 0 };

    const iois = [];
    const gaps = [];
    for (let i = 1; i < notes.length; i++) {
      const tCurr = V.requireFinite(notes[i].time, 'note.time');
      const tPrev = V.requireFinite(notes[i - 1].time, 'note.time');
      const dt = (tCurr - tPrev) * 1000;
      if (dt > 0) {
        iois.push(dt);
        if (dt > GAP_THRESHOLD_MS) gaps.push(tPrev * 1000 + dt / 2); // midpoint of gap
      }
    }

    const avgIOI = iois.length > 0 ? iois.reduce((a, b) => a + b, 0) / iois.length : 0;
    return { gaps, density: notes.length / 2, avgIOI };
  }

  /**
   * Suggest a rhythmic complement modification for current onsets.
   * In hocket mode: shifts onsets to fill other layer's gaps.
   * In antiphony mode: delays onsets to create response pattern.
   * In canon mode: imitates other layer's rhythm with a beat delay.
   * @param {string} layer
   * @param {number} onTick - current onset tick
   * @param {number} absTimeMs
   * @returns {{ tick: number, velocityScale: number, modified: boolean }}
   */
  function suggestComplement(layer, onTick, absTimeMs) {
    V.requireFinite(onTick, 'onTick');
    V.requireFinite(absTimeMs, 'absTimeMs');

    if (mode === 'free') return { tick: onTick, velocityScale: 1.0, modified: false };

    // If this layer is already resting, skip complement - rest takes priority
    if (restSynchronizer.isLayerResting(layer)) return { tick: onTick, velocityScale: 1.0, modified: false };

    const intent = sectionIntentCurves.getLastIntent() ?? { interactionTarget: 0.5 };

    // Only apply strong complement when interaction target is high
    const strength = clamp(intent.interactionTarget * STRENGTH_SCALE - STRENGTH_OFFSET, 0, 1);
    if (rf() > strength * STRENGTH_GATE) return { tick: onTick, velocityScale: 1.0, modified: false };

    if (mode === 'hocket') {
      // Shift onset by half a beat to interleave
      const halfBeatTicks = tpBeat * 0.5;
      const shift = halfBeatTicks * rf(HOCKET_SHIFT_MIN, HOCKET_SHIFT_MAX) * strength;
      return { tick: onTick + shift, velocityScale: 1.0 + strength * HOCKET_VEL_BOOST, modified: true };
    }

    if (mode === 'antiphony') {
      // Small delay for call-response feel
      const responseTicks = tpBeat * rf(ANTIPHONY_DELAY_MIN, ANTIPHONY_DELAY_MAX) * strength;
      return { tick: onTick + responseTicks, velocityScale: ANTIPHONY_VEL_BASE + strength * ANTIPHONY_VEL_SCALE, modified: true };
    }

    if (mode === 'canon') {
      // Apply groove offset from other layer for imitation effect
      let grooveOffset = grooveTransfer.applyOffset(crossLayerHelpers.getOtherLayer(layer), onTick, 'beat') - onTick;
      if (!Number.isFinite(grooveOffset)) grooveOffset = 0;
      return { tick: onTick + grooveOffset * strength * CANON_GROOVE_SCALE, velocityScale: CANON_VELOCITY, modified: grooveOffset !== 0 };
    }

    return { tick: onTick, velocityScale: 1.0, modified: false };
  }

  /** @returns {'hocket' | 'antiphony' | 'canon' | 'free'} */
  function getMode() { return mode; }

  /**
   * Set the rhythmic complement mode.
   * @param {'hocket' | 'antiphony' | 'canon' | 'free'} newMode
   */
  function setMode(newMode) {
    if (!['hocket', 'antiphony', 'canon', 'free'].includes(newMode)) {
      throw new Error('rhythmicComplementEngine.setMode: invalid mode "' + newMode + '"');
    }
    mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ (newMode);
    beatsSinceChange = 0;
  }

  /**
   * Auto-select mode based on musical context. Call once per beat.
   */
  function autoSelectMode(/* absTimeMs */) {
    beatsSinceChange++;
    if (beatsSinceChange < MODE_CHANGE_INTERVAL) return;

    const intent = sectionIntentCurves.getLastIntent() ?? { interactionTarget: 0.5, densityTarget: 0.5 };

    const interaction = V.optionalFinite(intent.interactionTarget, 0.5);
    const density = V.optionalFinite(intent.densityTarget, 0.5);

    // High interaction + low density - hocket (interleaving gaps)
    // High interaction + high density - antiphony (dense call/response)
    // Moderate everything - canon or free
    if (interaction > HIGH_INTERACTION && density < LOW_DENSITY) {
      mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('hocket');
    } else if (interaction > HIGH_INTERACTION && density > HIGH_DENSITY) {
      mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('antiphony');
    } else if (interaction > MODERATE_INTERACTION) {
      mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('canon');
    } else {
      mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('free');
    }
    beatsSinceChange = 0;
  }

  function reset() {
    mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('free');
    beatsSinceChange = 0;
  }

  return { analyzeOtherLayer, suggestComplement, getMode, setMode, autoSelectMode, reset };
})();
crossLayerRegistry.register('rhythmicComplementEngine', rhythmicComplementEngine, ['all', 'phrase']);
