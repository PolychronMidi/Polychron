// src/crossLayer/crossLayerDynamicEnvelope.js - Phrase-level dynamic arcs.
// Coordinates velocity envelopes across layers: parallel arcs (both crescendo
// together), complementary arcs (one rises while the other falls), or
// independent arcs. Provides per-beat velocity scaling factors.

crossLayerDynamicEnvelope = (() => {
  const V = validator.create('crossLayerDynamicEnvelope');

  /** @type {'parallel' | 'complementary' | 'independent'} */
  let arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('parallel');
  let phraseProgress = 0;
  let sectionProgress = 0;
  const SMOOTHING = 0.2;

  /** @type {Record<string, number>} per-layer smoothed velocity scale */
  let smoothedScale = crossLayerHelpers.createLayerPair(1.0);

  /**
   * Tick the envelope generator each beat.
   * @param {number} absTimeMs
   * @param {string} layer
   */
  function tick(absTimeMs, layer) {
    V.requireFinite(absTimeMs, 'absTimeMs');

    sectionProgress = clamp(timeStream.compoundProgress('section'), 0, 1);
    phraseProgress = clamp(timeStream.compoundProgress('phrase'), 0, 1);

    // Get intent-driven parameters
    const intent = sectionIntentCurves.getLastIntent();
    const densityTarget = V.optionalFinite(intent.densityTarget, 0.5);

    // Get interaction trend from interactionHeatMap
    const trend = interactionHeatMap.getTrend();

    // Check role swap
    const swapped = dynamicRoleSwap.getIsSwapped();

    // Compute base envelope from phrase arc
    const phraseArc = m.sin(phraseProgress * m.PI); // peaks mid-phrase
    const sectionArc = m.sin(sectionProgress * m.PI); // peaks mid-section

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

    // Modulate by interaction trend (hot system - slightly louder)
    targetScale += clamp(trend.slope, -0.5, 0.5) * 0.15;

    // R92 E3: Regime-responsive envelope amplitude. Exploring passages
    // benefit from wider dynamic swings (more dramatic crescendo/decrescendo),
    // coherent passages from tighter, more unified dynamics. This creates
    // distinct dynamic characters per regime without changing arc type.
    const snap = systemDynamicsProfiler.getSnapshot();
    const envelopeRegime = snap ? snap.regime : 'exploring';
    const regimeAmplitude = envelopeRegime === 'exploring' ? 1.20
      : envelopeRegime === 'coherent' ? 0.85
      : 1.0;
    // Scale the deviation from neutral (1.0) by regime amplitude
    targetScale = 1.0 + (targetScale - 1.0) * regimeAmplitude;

    targetScale = clamp(targetScale, 0.4, 1.6);

    // Smooth the transition (initialize on first call per layer)
    const prev = smoothedScale[layer] ?? 1.0;
    smoothedScale[layer] = prev * (1 - SMOOTHING) + targetScale * SMOOTHING;
  }

  /**
   * Get the velocity scale for a layer at the current moment.
   * @param {string} layer
   * @returns {number} 0.4-1.6
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
      throw new Error('crossLayerDynamicEnvelope.setArcType: invalid type "' + type + '"');
    }
    arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ (type);
  }

  /** @returns {'parallel' | 'complementary' | 'independent'} */
  function getArcType() { return arcType; }

  /**
   * Auto-select arc type based on intent, section position, and regime.
   * R73 E2: Added regime-awareness. Coherent regime favors parallel arcs
   * (unified layers), exploring favors complementary (layer contrast),
   * evolving favors independent (maximum differentiation). Regime input
   * blends with intent-based selection rather than overriding it.
   */
  function autoSelectArcType() {
    const intent = sectionIntentCurves.getLastIntent();
    const interaction = V.optionalFinite(intent.interactionTarget, 0.5);

    const snap = systemDynamicsProfiler.getSnapshot();
    const regime = snap ? snap.regime : 'exploring';

    // R2 E2: Phase-aware arc type bias. When phase axis is starved,
    // bias toward complementary arcs which create cross-layer velocity
    // interference that feeds phase coupling energy. This is a structural
    // feedback loop: low phase share -> more complementary arcs -> more
    // cross-layer contrast -> more phase coupling energy.
    const phaseAxisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    const phaseStarved = phaseAxisEnergy && phaseAxisEnergy.shares
      && typeof phaseAxisEnergy.shares.phase === 'number'
      && phaseAxisEnergy.shares.phase < 0.14;

    if (regime === 'coherent') {
      // Coherent: bias toward parallel (unified crescendo/decrescendo)
      // R2 E2: When phase is starved, shift threshold so complementary
      // is chosen more often even during coherent passages.
      const coherentThreshold = phaseStarved ? 0.60 : 0.45;
      arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ (
        interaction > coherentThreshold ? 'parallel' : 'complementary'
      );
    } else if (regime === 'evolving') {
      // Evolving: bias toward independent (maximum differentiation)
      // R78 E5: Widen range -- lower threshold from 0.55 to 0.45 so
      // more evolving beats get independent arcs, creating stronger
      // layer autonomy during transitional passages.
      arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ (
        interaction > 0.45 ? 'complementary' : 'independent'
      );
    } else {
      // R99 E4: Widen exploring complementary arc band (was 0.35-0.65, now 0.28-0.72).
      // More complementary arcs during exploring creates greater layer contrast,
      // feeding phase axis energy through cross-layer velocity interference patterns.
      if (interaction > 0.72) {
        arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('parallel');
      } else if (interaction > 0.28) {
        arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('complementary');
      } else {
        arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('independent');
      }
    }
  }

  function reset() {
    arcType = /** @type {'parallel' | 'complementary' | 'independent'} */ ('parallel');
    phraseProgress = 0;
    sectionProgress = 0;
    smoothedScale = crossLayerHelpers.createLayerPair(1.0);
  }

  return { tick, getVelocityScale, setArcType, getArcType, autoSelectArcType, reset };
})();
crossLayerRegistry.register('crossLayerDynamicEnvelope', crossLayerDynamicEnvelope, ['all', 'section']);
