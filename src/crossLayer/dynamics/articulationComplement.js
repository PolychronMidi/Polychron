// src/crossLayer/articulationComplement.js - Cross-layer articulation contrast.
// When one layer plays legato (long sustains), steers the other toward staccato
// (short, punchy notes) and vice versa. Creates complementary articulation
// textures driven by dynamicRoleSwap and sectionIntentCurves.

articulationComplement = (() => {
  const V = validator.create('articulationComplement');
  const WINDOW_SIZE = 16;
  // R73 E4: Section-progressive contrast. Base 0.5 grows to 0.8 across
  // sections via sectionRoute, creating stronger articulation contrast
  // in mid/late sections for richer coupling texture variety.
  const CONTRAST_BASE = 0.5;
  const CONTRAST_GROWTH = 0.3;

  /** @type {Map<string, number[]>} recent sustain durations per layer (in seconds) */
  const sustainHistory = new Map();

  /**
   * Record a sustain duration from a layer.
   * @param {string} layer
   * @param {number} sustainSec
   * @param {number} absoluteSeconds
   */
  function recordSustain(layer, sustainSec, absoluteSeconds) {
    V.requireFinite(sustainSec, 'sustainSec');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    if (!sustainHistory.has(layer)) sustainHistory.set(layer, []);
    const hist = sustainHistory.get(layer);
    if (!hist) throw new Error('articulationComplement.recordSustain: missing history for ' + layer);
    hist.push(sustainSec);
    if (hist.length > WINDOW_SIZE) hist.shift();
    L0.post('articulation', layer, absoluteSeconds, { sustainSec, avgSustain: hist.reduce((a, b) => a + b, 0) / hist.length });
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
    const beatTicks = spBeat;
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
    const otherLayer = crossLayerHelpers.getOtherLayer(activeLayer);
    const otherProfile = getArticulationProfile(otherLayer);
    const selfProfile = getArticulationProfile(activeLayer);

    // Bias contrast toward complementary when self is neutral
    const selfLegatoBias = selfProfile.isLegato ? -0.15 : (selfProfile.isStaccato ? 0.1 : 0);

    // Get intent to modulate contrast strength
    const intent = sectionIntentCurves.getLastIntent() ?? { interactionTarget: 0.5 };
    const interactionTarget = V.optionalFinite(intent.interactionTarget, 0.5);

    // R73 E4: Section-progressive contrast strength
    const sectionBounds = timeStream.getBounds('section');
    const sectionPos = timeStream.getPosition('section');
    const sectionRoute = sectionBounds > 1 ? sectionPos / (sectionBounds - 1) : 0;
    const contrastStrength = CONTRAST_BASE + m.sin(clamp(sectionRoute, 0, 1) * m.PI) * CONTRAST_GROWTH;

    // R92 E4: Regime-responsive articulation contrast. Exploring passages
    // benefit from stronger staccato/legato separation (more contrast = more
    // textural variety and coupling dimension activity). Coherent passages
    // get subtler contrast for unified articulation. Creates regime-specific
    // articulation character that enriches coupling texture diversity.
    const snap = systemDynamicsProfiler.getSnapshot();
    const artRegime = snap ? snap.regime : 'exploring';
    const regimeContrast = artRegime === 'exploring' ? 1.25
      : artRegime === 'coherent' ? 0.80
      : 1.0;
    const effectiveContrast = contrastStrength * regimeContrast;

    // Check role swap state
    const swapped = dynamicRoleSwap.getIsSwapped() ?? false;

    // Base contrast: if other layer is legato, make this one more staccato
    let sustainScale = 1.0;
    let preferredStutterType = 'fade';

    const contagionMode = artRegime === 'coherent';
    if (otherProfile.isLegato) {
      if (contagionMode) {
        sustainScale = clamp(1.0 + effectiveContrast * interactionTarget * 0.5, 1.0, 1.8);
        preferredStutterType = 'fade';
      } else {
        sustainScale = clamp(1.0 - effectiveContrast * interactionTarget + selfLegatoBias, 0.3, 1.0);
        preferredStutterType = 'chop';
      }
    } else if (otherProfile.isStaccato) {
      if (contagionMode) {
        sustainScale = clamp(1.0 - effectiveContrast * interactionTarget * 0.5, 0.4, 1.0);
        preferredStutterType = 'chop';
      } else {
        sustainScale = clamp(1.0 + effectiveContrast * interactionTarget, 1.0, 2.0);
        preferredStutterType = 'fade';
      }
    }

    // Role swap inverts the contrast
    if (swapped) {
      sustainScale = 1.0 / m.max(0.3, sustainScale);
      sustainScale = clamp(sustainScale, 0.3, 2.0);
    }

    return { sustainScale, preferredStutterType };
  }

  function reset() {
    sustainHistory.clear();
  }

  return { recordSustain, getArticulationProfile, getSustainModifier, reset };
})();
crossLayerRegistry.register('articulationComplement', articulationComplement, ['all', 'section']);
