// src/crossLayer/texturalMirror.js - Cross-layer texture management.
// Tracks each layer's texture mode and suggests complementary or contrasting
// textures for the other layer. Consumes dynamicRoleSwap chordalBias/melodicBias
// (dead-end signals) to drive texture decisions.

texturalMirror = (() => {
  const V = validator.create('texturalMirror');
  const COMPLEMENT_MAP = Object.freeze({
    normal: 'normal',
    chordBurst: 'sparse',
    flurry: 'normal',
    sparse: 'chordBurst',
    dense: 'flurry'
  });

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

    // Get role swap modifiers (consuming dead-end signals)
    const roleProfile = dynamicRoleSwap.getProfileModifiers(activeLayer) ?? { chordalBias: 0, melodicBias: 0, isSwapped: false };
    const chordalBias = V.optionalFinite(roleProfile.chordalBias, 0);
    const melodicBias = V.optionalFinite(roleProfile.melodicBias, 0);

    // Default if no other layer data
    if (!layerTextures[otherLayer]) {
      return { preferredMode: 'normal', weight: 0.1 };
    }

    const otherMode = layerTextures[otherLayer].mode;
    let preferredMode = COMPLEMENT_MAP[otherMode] || 'normal';

    // Chordal bias pushes toward chordBurst
    if (chordalBias > 0.2) {
      preferredMode = 'chordBurst';
    } else if (melodicBias > 0.2) {
      preferredMode = 'flurry';
    }

    // Weight: higher interaction target - stronger suggestion
    // R92 E5: Regime-responsive texture suggestion weight. Exploring
    // passages benefit from stronger cross-layer texture contrast (more
    // complementary or contrasting textures create richer coupling surface).
    // Coherent passages get weaker suggestions for unified texture.
    // Creates regime-specific textural behavior that enriches the
    // coupling dimension landscape.
    const snap = systemDynamicsProfiler.getSnapshot();
    const texRegime = snap ? snap.regime : 'exploring';
    const regimeWeightScale = texRegime === 'exploring' ? 1.20
      : texRegime === 'coherent' ? 0.75
      : 1.0;
    const weight = clamp(interactionTarget * 0.7 * regimeWeightScale, 0.1, 0.8);

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

  return { recordTexture, suggestTexture, getTextureDistance, reset };
})();
crossLayerRegistry.register('texturalMirror', texturalMirror, ['all', 'section']);
