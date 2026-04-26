// src/crossLayer/texturalMirror.js - Cross-layer texture management.
// Tracks each layer's texture mode and suggests complementary or contrasting
// textures for the other layer. Consumes dynamicRoleSwap chordalBias/melodicBias
// (dead-end signals) to drive texture decisions.

moduleLifecycle.declare({
  name: 'texturalMirror',
  subsystem: 'crossLayer',
  deps: ['L0', 'regimeClassifier', 'validator'],
  lazyDeps: ['conductorSignalBridge', 'crossLayerHelpers', 'dynamicRoleSwap', 'emergentMelodicEngine', 'sectionIntentCurves'],
  provides: ['texturalMirror'],
  crossLayerScopes: ['all', 'section'],
  init: (deps) => {
  const L0 = deps.L0;
  const regimeClassifier = deps.regimeClassifier;
  const V = deps.validator.create('texturalMirror');
  const COMPLEMENT_MAP = Object.freeze({
    normal: 'normal',
    chordBurst: 'sparse',
    flurry: 'normal',
    sparse: 'chordBurst',
    dense: 'flurry'
  });

  let cimScale = 0.5;

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  /** @type {Record<string, { mode: string, timestamp: number }>} */
  const layerTextures = {};

  /**
   * Record the current texture mode of a layer.
   * @param {string} layer
   * @param {string} mode
   * @param {number} absoluteSeconds
   */
  function recordTexture(layer, mode, absoluteSeconds) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    layerTextures[layer] = { mode: String(mode), timestamp: absoluteSeconds };
  }

  /**
   * Suggest a texture for the active layer based on the other layer's texture.
   * @param {string} activeLayer
   * @param {number} absoluteSeconds
   * @returns {{ preferredMode: string, weight: number }}
   */
  function suggestTexture(activeLayer, absoluteSeconds) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    const otherLayer = crossLayerHelpers.getOtherLayer(activeLayer);

    // Get intent
    const intent = sectionIntentCurves.getLastIntent() ?? { interactionTarget: 0.5, densityTarget: 0.5 };
    const interactionTarget = V.optionalFinite(intent.interactionTarget, 0.5);
    // entropyRegulator antagonism bridge (r=-0.426): high density -> strengthen structural correction
    const densityTarget = V.optionalFinite(intent.densityTarget, 0.5);
    const densityBridgeMod = densityTarget > 0.7 ? 0.05 : 0;

    // Get role swap modifiers (consuming dead-end signals)
    const roleProfile = dynamicRoleSwap.getProfileModifiers(activeLayer) ?? { chordalBias: 0, melodicBias: 0, isSwapped: false };
    const chordalBias = V.optionalFinite(roleProfile.chordalBias, 0);
    const melodicBias = V.optionalFinite(roleProfile.melodicBias, 0);

    // Default if no other layer data
    if (!layerTextures[otherLayer]) {
      return { preferredMode: 'normal', weight: 0.1 };
    }

    const otherMode = layerTextures[otherLayer].mode;
    // R30 lab: regime-texture-mirror -- coherent mirrors other layer's texture,
    // exploring opposes it. Creates regime-aware cross-layer relationship.
    const mirrorRegime = regimeClassifier.getRegime();
    let preferredMode = mirrorRegime === 'coherent'
      ? otherMode
      : (COMPLEMENT_MAP[otherMode] || 'normal');

    // Chordal bias pushes toward chordBurst
    if (chordalBias > 0.2) {
      preferredMode = 'chordBurst';
    } else if (melodicBias > 0.2) {
      preferredMode = 'flurry';
    }

    // R59: melodic contour gates texture mode. Rising arc builds energy -> push toward
    // energetic textures; falling releases energy -> calm down. High thematic density ->
    // reduce texture complexity (motif echo already provides melodic richness).
    const melodicCtxTM = emergentMelodicEngine.getContext();
    if (melodicCtxTM) {
      if (melodicCtxTM.contourShape === 'rising') {
        if (preferredMode === 'sparse') preferredMode = 'normal';
        else if (preferredMode === 'normal') preferredMode = 'flurry';
      } else if (melodicCtxTM.contourShape === 'falling') {
        if (preferredMode === 'flurry' || preferredMode === 'dense') preferredMode = 'normal';
        else if (preferredMode === 'chordBurst') preferredMode = 'sparse';
      }
      if (melodicCtxTM.thematicDensity > 0.65 && preferredMode === 'dense') preferredMode = 'normal';
    }

    // Weight: higher interaction target - stronger suggestion
    // R92 E5: Regime-responsive texture suggestion weight. Exploring
    // passages benefit from stronger cross-layer texture contrast (more
    // complementary or contrasting textures create richer coupling surface).
    // Coherent passages get weaker suggestions for unified texture.
    // Creates regime-specific textural behavior that enriches the
    // coupling dimension landscape.
    const texRegime = conductorSignalBridge.getSignals().regime || 'exploring';
    const regimeWeightScale = texRegime === 'exploring' ? 1.20
      : texRegime === 'coherent' ? 0.75
      : 1.0;
    // Coherence-aware: poor coherence = stronger texture suggestions to create differentiation
    const coherenceEntry = L0.getLast(L0_CHANNELS.coherence, { layer: 'both' });
    const coherenceBoost = coherenceEntry ? clamp(m.abs(V.optionalFinite(coherenceEntry.bias, 1.0) - 1.0) * 0.4, 0, 0.15) : 0;
    // R34: spectral L0 awareness -- sparse spectrum = densify texture, full spectrum = thin
    const spectralEntry = L0.getLast(L0_CHANNELS.spectral, { layer: otherLayer });
    const spectralBoost = (() => {
      if (!spectralEntry) return 0;
      V.assertArray(spectralEntry.histogram, 'spectralEntry.histogram');
      const h = spectralEntry.histogram;
      const mean = h.reduce((a, b) => a + b, 0) / m.max(h.length, 1);
      let variance = 0;
      for (let si = 0; si < h.length; si++) variance += (h[si] - mean) * (h[si] - mean);
      variance /= m.max(h.length, 1);
      return clamp(0.5 - m.sqrt(variance) * 2, -0.1, 0.15);
    })();
    const melodicWeightTM = melodicCtxTM
      ? (melodicCtxTM.contourShape === 'rising' ? 1.12 : melodicCtxTM.contourShape === 'falling' ? 0.88 : 1.0)
        * (melodicCtxTM.counterpoint === 'contrary' ? 1.08 : 1.0)
      : 1.0;
    // R73: emergentRhythm hotspots coupling -- rhythmic burst positions boost texture suggestion weight.
    const rhythmEntryTM = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const hotspotsScaleTM = rhythmEntryTM && Array.isArray(rhythmEntryTM.hotspots) ? rhythmEntryTM.hotspots.length / 16 : 0;
    const weight = clamp(interactionTarget * 0.7 * regimeWeightScale * (1.5 - cimScale) * melodicWeightTM * (1.0 + hotspotsScaleTM * 0.12) + coherenceBoost + spectralBoost + densityBridgeMod, 0.1, 0.8);

    return { preferredMode, weight };
  }

  /**
   * Get the "texture distance" between layers (how different they are).
   * 0 = identical textures, 1 = maximally contrasting.
   * @returns {number}
   */
  function getTextureDistance() {
    const l1 = layerTextures.L1;
    const l2 = layerTextures.L2;
    if (!l1 || !l2) return 0;
    if (l1.mode === l2.mode) return 0;
    // Simple heuristic: each mode gets an "energy" score
    const energy = { normal: 0.5, sparse: 0.2, dense: 0.8, chordBurst: 0.7, flurry: 0.9 };
    const e1 = energy[l1.mode] ?? 0.5;
    const e2 = energy[l2.mode] ?? 0.5;
    return clamp(m.abs(e1 - e2) * 2, 0, 1);
  }

  function reset() {
    Object.keys(layerTextures).forEach(k => delete layerTextures[k]);
  }

  return { recordTexture, suggestTexture, getTextureDistance, setCoordinationScale, reset };
  },
});
