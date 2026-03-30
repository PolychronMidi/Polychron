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
   * @param {number} absoluteSeconds
   * @returns {{ gaps: number[], density: number, avgIOI: number }}
   */
  function analyzeOtherLayer(activeLayer, absoluteSeconds) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    const otherLayer = crossLayerHelpers.getOtherLayer(activeLayer);

    const notes = L0.query('note', {
      layer: otherLayer,
      since: absoluteSeconds - ANALYSIS_WINDOW_S,
      windowSeconds: ANALYSIS_WINDOW_S
    });

    if (notes.length < 2) return { gaps: [], density: notes.length / ANALYSIS_WINDOW_S, avgIOI: 0 };

    const iois = [];
    const gaps = [];
    for (let i = 1; i < notes.length; i++) {
      const tCurr = V.requireFinite(notes[i].timeInSeconds, 'note.timeInSeconds');
      const tPrev = V.requireFinite(notes[i - 1].timeInSeconds, 'note.timeInSeconds');
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
   * @param {number} onTime - current onset time (seconds)
   * @param {number} absoluteSeconds
   * @returns {{ time: number, velocityScale: number, modified: boolean }}
   */
  function suggestComplement(layer, onTime, absoluteSeconds) {
    V.requireFinite(onTime, 'onTime');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');

    if (mode === 'free') return { time: onTime, velocityScale: 1.0, modified: false };

    // If this layer is already resting, skip complement - rest takes priority
    if (restSynchronizer.isLayerResting(layer)) return { time: onTime, velocityScale: 1.0, modified: false };

    const intent = sectionIntentCurves.getLastIntent() ?? { interactionTarget: 0.5 };

    // Only apply strong complement when interaction target is high
    const strength = clamp(intent.interactionTarget * STRENGTH_SCALE - STRENGTH_OFFSET, 0, 1);
    if (rf() > strength * STRENGTH_GATE) return { time: onTime, velocityScale: 1.0, modified: false };

    if (mode === 'hocket') {
      // Shift onset by half a beat to interleave (seconds)
      const halfBeatSecs = spBeat * 0.5;
      const shift = halfBeatSecs * rf(HOCKET_SHIFT_MIN, HOCKET_SHIFT_MAX) * strength;
      return { time: onTime + shift, velocityScale: 1.0 + strength * HOCKET_VEL_BOOST, modified: true };
    }

    if (mode === 'antiphony') {
      // Small delay for call-response feel (seconds)
      const responseSecs = spBeat * rf(ANTIPHONY_DELAY_MIN, ANTIPHONY_DELAY_MAX) * strength;
      return { time: onTime + responseSecs, velocityScale: ANTIPHONY_VEL_BASE + strength * ANTIPHONY_VEL_SCALE, modified: true };
    }

    if (mode === 'canon') {
      // Apply groove offset from other layer for imitation effect
      let grooveOffset = grooveTransfer.applyOffset(crossLayerHelpers.getOtherLayer(layer), onTime, 'beat') - onTime;
      if (!Number.isFinite(grooveOffset)) grooveOffset = 0;
      return { time: onTime + grooveOffset * strength * CANON_GROOVE_SCALE, velocityScale: CANON_VELOCITY, modified: grooveOffset !== 0 };
    }

    return { time: onTime, velocityScale: 1.0, modified: false };
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
  function autoSelectMode(/* absoluteSeconds */) {
    beatsSinceChange++;
    if (beatsSinceChange < MODE_CHANGE_INTERVAL) return;

    const intent = sectionIntentCurves.getLastIntent() ?? { interactionTarget: 0.5, densityTarget: 0.5 };

    const interaction = V.optionalFinite(intent.interactionTarget, 0.5);
    const density = V.optionalFinite(intent.densityTarget, 0.5);

    // Harmonic distance awareness: far from home key favors canon (coherence in distant territory)
    const harmonicEntry = L0.getLast('harmonic', { layer: 'both' });
    const excursion = harmonicEntry ? V.optionalFinite(harmonicEntry.excursion, 0) : 0;
    const farFromHome = excursion > 4;

    // Rhythm awareness: read other layer's rhythm pattern from L0
    const otherLayer = crossLayerHelpers.getOtherLayer(LM.activeLayer || 'L1');
    const otherRhythm = L0.getLast('rhythm', { layer: otherLayer });
    const otherIsDense = otherRhythm && (otherRhythm.method === 'onsets' || otherRhythm.method === 'random');

    // Lab R2: coherent+canon was "excellent" - favor canon during coherent regime
    // Lab R8: atmospheric+canon was "legendary" - favor canon during atmospheric profile
    const currentRegime = regimeClassifier.getLastRegime();
    const inCoherent = currentRegime === 'coherent';
    const inAtmospheric = conductorConfig.getActiveProfileName() === 'atmospheric';

    if ((inCoherent || inAtmospheric) && interaction > MODERATE_INTERACTION) {
      mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('canon');
    } else if (farFromHome && interaction > MODERATE_INTERACTION) {
      mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('canon');
    } else if (otherIsDense && interaction > MODERATE_INTERACTION) {
      mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('hocket');
    } else if (currentRegime === 'exploring' && density > HIGH_DENSITY && interaction > MODERATE_INTERACTION) {
      // Lab R2: hocket+high-entropy was "great" -favor hocket during dense exploring
      mode = /** @type {'hocket' | 'antiphony' | 'canon' | 'free'} */ ('hocket');
    } else if (interaction > HIGH_INTERACTION && density < LOW_DENSITY) {
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
