// src/crossLayer/crossLayerDynamicEnvelope.js — Phrase-level dynamic arcs.
// Coordinates velocity envelopes across layers: parallel arcs (both crescendo
// together), complementary arcs (one rises while the other falls), or
// independent arcs. Provides per-beat velocity scaling factors.

CrossLayerDynamicEnvelope = (() => {
  const V = Validator.create('crossLayerDynamicEnvelope');

  /** @type {'parallel' | 'complementary' | 'independent'} */
  let arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('parallel');
  let phraseProgress = 0;
  let sectionProgress = 0;
  const SMOOTHING = 0.2;

  /** @type {Record<string, number>} per-layer smoothed velocity scale */
  const smoothedScale = { L1: 1.0, L2: 1.0 };

  /**
   * Tick the envelope generator each beat.
   * @param {number} absTimeMs
   * @param {string} layer
   */
  function tick(absTimeMs, layer) {
    V.requireFinite(absTimeMs, 'absTimeMs');

    sectionProgress = clamp(TimeStream.compoundProgress('section'), 0, 1);
    phraseProgress = clamp(TimeStream.compoundProgress('phrase'), 0, 1);

    // Get intent-driven parameters
    const intent = SectionIntentCurves.getLastIntent();
    const densityTarget = V.optionalFinite(intent.densityTarget, 0.5);

    // Get interaction trend from InteractionHeatMap
    const trend = InteractionHeatMap.getTrend();

    // Check role swap
    const swapped = DynamicRoleSwap.getIsSwapped();

    // Compute base envelope from phrase arc
    const phraseArc = Math.sin(phraseProgress * Math.PI); // peaks mid-phrase
    const sectionArc = Math.sin(sectionProgress * Math.PI); // peaks mid-section

    let targetScale = 1.0;

    if (arcType === 'parallel') {
      // Both layers follow the same dynamic arc
      targetScale = 0.6 + phraseArc * 0.6 + sectionArc * 0.2;
    } else if (arcType === 'complementary') {
      // L1 and L2 have inverse arcs
      const isL1 = (layer === 'L1') !== swapped; // role swap inverts which layer rises
      if (isL1) {
        targetScale = 0.5 + phraseArc * 0.8;
      } else {
        targetScale = 1.3 - phraseArc * 0.6;
      }
    } else {
      // Independent: each layer follows its own density-driven curve
      targetScale = 0.7 + densityTarget * 0.6;
    }

    // Modulate by interaction trend (hot system → slightly louder)
    targetScale += clamp(trend.slope, -0.5, 0.5) * 0.15;

    targetScale = clamp(targetScale, 0.4, 1.6);

    // Smooth the transition (initialize on first call per layer)
    const prev = smoothedScale[layer] ?? 1.0;
    smoothedScale[layer] = prev * (1 - SMOOTHING) + targetScale * SMOOTHING;
  }

  /**
   * Get the velocity scale for a layer at the current moment.
   * @param {string} layer
   * @returns {number} 0.4–1.6
   */
  function getVelocityScale(layer) {
    return clamp(smoothedScale[layer] ?? 1.0, 0.4, 1.6);
  }

  /**
   * Set the arc type.
   * @param {'parallel' | 'complementary' | 'independent'} type
   */
  function setArcType(type) {
    if (!['parallel', 'complementary', 'independent'].includes(type)) {
      throw new Error('CrossLayerDynamicEnvelope.setArcType: invalid type "' + type + '"');
    }
    arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ (type);
  }

  /** @returns {'parallel' | 'complementary' | 'independent'} */
  function getArcType() { return arcType; }

  /**
   * Auto-select arc type based on intent and section position.
   */
  function autoSelectArcType() {
    const intent = SectionIntentCurves.getLastIntent();

    const interaction = V.optionalFinite(intent.interactionTarget, 0.5);
    if (interaction > 0.65) {
      arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('parallel');
    } else if (interaction > 0.35) {
      arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('complementary');
    } else {
      arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('independent');
    }
  }

  function reset() {
    arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('parallel');
    phraseProgress = 0;
    sectionProgress = 0;
    smoothedScale.L1 = 1.0;
    smoothedScale.L2 = 1.0;
  }

  return { tick, getVelocityScale, setArcType, getArcType, autoSelectArcType, reset };
})();
CrossLayerRegistry.register('CrossLayerDynamicEnvelope', CrossLayerDynamicEnvelope, ['all', 'section']);
