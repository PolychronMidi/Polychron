// src/crossLayer/articulationComplement.js — Cross-layer articulation contrast.
// When one layer plays legato (long sustains), steers the other toward staccato
// (short, punchy notes) and vice versa. Creates complementary articulation
// textures driven by DynamicRoleSwap and SectionIntentCurves.

ArticulationComplement = (() => {
  const V = Validator.create('ArticulationComplement');
  const WINDOW_SIZE = 16;
  const CONTRAST_STRENGTH = 0.6;

  /** @type {Map<string, number[]>} recent sustain durations per layer (in ticks) */
  const sustainHistory = new Map();

  /**
   * Record a sustain duration from a layer.
   * @param {string} layer
   * @param {number} sustainTicks
   * @param {number} absTimeMs
   */
  function recordSustain(layer, sustainTicks, absTimeMs) {
    V.requireFinite(sustainTicks, 'sustainTicks');
    V.requireFinite(absTimeMs, 'absTimeMs');
    if (!sustainHistory.has(layer)) sustainHistory.set(layer, []);
    const hist = sustainHistory.get(layer);
    if (!hist) throw new Error('ArticulationComplement.recordSustain: missing history for ' + layer);
    hist.push(sustainTicks);
    if (hist.length > WINDOW_SIZE) hist.shift();
  }

  /**
   * Get the articulation profile for a layer (average sustain length).
   * @param {string} layer
   * @returns {{ avgSustain: number, isLegato: boolean, isStaccato: boolean }}
   */
  function getArticulationProfile(layer) {
    const hist = sustainHistory.get(layer);
    if (!hist || hist.length === 0) {
      return { avgSustain: 0.5, isLegato: false, isStaccato: false };
    }
    const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
    const beatTicks = Number.isFinite(tpBeat) ? tpBeat : 480;
    const normalized = avg / beatTicks; // ratio of sustain to beat length
    return {
      avgSustain: normalized,
      isLegato: normalized > 0.7,
      isStaccato: normalized < 0.3
    };
  }

  /**
   * Get sustain modifier for the active layer based on the other layer's articulation.
   * @param {string} activeLayer
   * @returns {{ sustainScale: number, preferredStutterType: string }}
   */
  function getSustainModifier(activeLayer) {
    const otherLayer = activeLayer === 'L1' ? 'L2' : 'L1';
    const otherProfile = getArticulationProfile(otherLayer);
    const selfProfile = getArticulationProfile(activeLayer);

    // Bias contrast toward complementary when self is neutral
    const selfLegatoBias = selfProfile.isLegato ? -0.15 : (selfProfile.isStaccato ? 0.1 : 0);

    // Get intent to modulate contrast strength
    const intent = (typeof SectionIntentCurves !== 'undefined' && SectionIntentCurves &&
      typeof SectionIntentCurves.getLastIntent === 'function')
      ? SectionIntentCurves.getLastIntent()
      : { interactionTarget: 0.5 };
    const interactionTarget = Number.isFinite(intent.interactionTarget) ? intent.interactionTarget : 0.5;

    // Check role swap state
    const swapped = (typeof DynamicRoleSwap !== 'undefined' && DynamicRoleSwap &&
      typeof DynamicRoleSwap.getIsSwapped === 'function')
      ? DynamicRoleSwap.getIsSwapped()
      : false;

    // Base contrast: if other layer is legato, make this one more staccato
    let sustainScale = 1.0;
    let preferredStutterType = 'fade';

    if (otherProfile.isLegato) {
      // Other is legato → we should be staccato (modulated by own profile)
      sustainScale = clamp(1.0 - CONTRAST_STRENGTH * interactionTarget + selfLegatoBias, 0.3, 1.0);
      preferredStutterType = 'chop';
    } else if (otherProfile.isStaccato) {
      // Other is staccato → we should be legato
      sustainScale = clamp(1.0 + CONTRAST_STRENGTH * interactionTarget, 1.0, 2.0);
      preferredStutterType = 'fade';
    }

    // Role swap inverts the contrast
    if (swapped) {
      sustainScale = 1.0 / Math.max(0.3, sustainScale);
      sustainScale = clamp(sustainScale, 0.3, 2.0);
    }

    return { sustainScale, preferredStutterType };
  }

  function reset() {
    sustainHistory.clear();
  }

  return { recordSustain, getArticulationProfile, getSustainModifier, reset };
})();
