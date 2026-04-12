// src/rhythm/phaseLockedRhythmGenerator.js - Phase-locked polyrhythmic generation
// Enables explicit polyrhythmic interlocking via phase offset tracking
// Reflects African music principles: cyclic patterns with phase relationships

phaseLockedRhythmGenerator = (() => {
  const V = validator.create('phaseLockedRhythmGenerator');
  const phases = new Map();         // Map<layerName:patternName:length, offset>
  const generationHistory = [];     // Track recent generations for coherence analysis
  let activeLayer = null;           // Track which layer is currently active for phase context

  /**
   * Set active layer context for phase tracking
   * @param {string} layerName - Layer name (e.g., 'L1', 'L2')
   * @returns {void}
   */
  function setActiveLayer(layerName) {
    V.assertNonEmptyString(layerName, 'layerName');
    activeLayer = layerName;
  }

  /**
   * Initialize polyrhythmic cross-layer phase relationship
   * @param {string} layer1 - First layer name
   * @param {string} layer2 - Second layer name
   * @param {number} ratio1 - Measures for layer1 in polyrhythm cycle
   * @param {number} ratio2 - Measures for layer2 in polyrhythm cycle
   * @returns {void}
   */
  function initializePolyrhythmCoupling(layer1, layer2, ratio1, ratio2) {
    V.assertNonEmptyString(layer1, 'layer1');
    V.assertNonEmptyString(layer2, 'layer2');
    if (!Number.isInteger(ratio1) || ratio1 <= 0 || !Number.isInteger(ratio2) || ratio2 <= 0) {
      throw new Error(`phaseLockedRhythmGenerator.initializePolyrhythmCoupling: ratios must be positive integers (got ${ratio1}, ${ratio2})`);
    }
    // Phase offset based on ratio: layer2 offset = (ratio1 / (ratio1 + ratio2)) * pattern_length
    // This is computed dynamically per pattern to maintain polyrhythmic coherence
    // Store coupling metadata for reference
    phases.set(`phaseLockedRhythmGeneratorCoupling:${layer1}:${layer2}`, { ratio1, ratio2 });
  }

  /**
   * Generate rhythm pattern with phase locking (layer-aware)
   * @param {number} length - Pattern length
   * @param {string} patternName - Name of pattern generator (must be registered in rhythmRegistry)
   * @param {number} [phaseOffset] - Optional explicit phase offset; uses stored phase if omitted
   * @returns {Array} rotated rhythm pattern
   * @throws {Error} if length invalid, patternName not found, or offset calculation fails
   */
  function generate(length, patternName, phaseOffset = undefined) {
    V.requireFinite(length, 'length');
    V.assertNonEmptyString(patternName, 'patternName');

    // Generate base pattern via rhythmRegistry
    let pattern;
    try {
      pattern = rhythmRegistry.execute(patternName, length);
    } catch (e) {
      throw new Error(`phaseLockedRhythmGenerator.generate: failed to execute pattern "${patternName}": ${e && e.message ? e.message : e}`);
    }

    V.assertArray(pattern, 'pattern');
    if (pattern.length === 0) {
      throw new Error(`phaseLockedRhythmGenerator.generate: pattern "${patternName}" returned invalid result`);
    }

    // Determine phase offset using (layerName:patternName, length) tuple key
    const phaseKeyBase = activeLayer ? `${activeLayer}:${patternName}` : patternName;
    const phaseKey = `${phaseKeyBase}:${length}`;
    let offset = 0;
    if (typeof phaseOffset === 'number' && Number.isFinite(phaseOffset)) {
      offset = phaseOffset;
    } else if (phases.has(phaseKey)) {
      offset = phases.get(phaseKey);
    } else if (activeLayer) {
      for (const [key, meta] of phases.entries()) {
        if (!V.optionalType(key, 'string') || !key.startsWith('phaseLockedRhythmGeneratorCoupling:')) continue;
        const parts = key.split(':');
        const layer1 = parts[1];
        const layer2 = parts[2];
        // consider couplings where the active layer is either side
        if (activeLayer !== layer1 && activeLayer !== layer2) continue;
        const ratio1 = meta && Number.isFinite(Number(meta.ratio1)) ? Number(meta.ratio1) : null;
        const ratio2 = meta && Number.isFinite(Number(meta.ratio2)) ? Number(meta.ratio2) : null;
        if (ratio1 && ratio2) {
          // if activeLayer is layer2 use ratio1 contribution; if activeLayer is layer1 invert
          offset = (activeLayer === layer2)
            ? m.round((ratio1 / (ratio1 + ratio2)) * length)
            : m.round((ratio2 / (ratio1 + ratio2)) * length);
          break;
        }
      }
    }

    // Texture-driven phase drift (#9)
    // Chord bursts - advance phase (layers drift apart - polyrhythmic tension)
    // Flurries - negative drift (layers re-align - convergence)
    const texMetrics = drumTextureCoupler.getMetrics();
    let textureDrift = 0;
    if (texMetrics.intensity > 0.2) {
      const driftParams = conductorConfig.getRhythmDriftParams();
      const burstDom = texMetrics.burstCount > texMetrics.flurryCount;
      textureDrift = burstDom
        ? m.round(texMetrics.intensity * rf(driftParams.burst[0], driftParams.burst[1]))    // divergence
        : -m.round(texMetrics.intensity * rf(driftParams.flurry[0], driftParams.flurry[1])); // convergence
    }

    try {
      const snap = systemDynamicsProfiler.getSnapshot();
      const dynamicSnap = /** @type {any} */ (snap);
      const sectionProgress = clamp(timeStream.compoundProgress('section'), 0, 1);
      const textureStarved = texMetrics.intensity < 0.15;
      const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
      const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
        ? axisEnergy.shares.phase
        : 1.0 / 6.0;
      const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
        ? axisEnergy.shares.trust
        : 1.0 / 6.0;
      const lowPhaseThreshold = phaseFloorController.getLowShareThreshold();
      const collapseThreshold = phaseFloorController.getCollapseThreshold();
      const softPhaseTarget = 0.10;
      const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1.5);
      const softPhaseDeficit = clamp((softPhaseTarget - phaseShare) / softPhaseTarget, 0, 1);
      const needsPhaseRescue = phaseShare < lowPhaseThreshold;
      const deepPhaseCollapse = phaseShare < collapseThreshold;
      const trustSharePressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
      const couplingPressures = pipelineCouplingManager.getCouplingPressures();
      const densityFlickerPressure = clamp((V.optionalFinite(couplingPressures['density-flicker'], 0) - 0.74) / 0.18, 0, 1);
      const densityTrustPressure = clamp((V.optionalFinite(couplingPressures['density-trust'], 0) - 0.72) / 0.18, 0, 1);
      const flickerTrustPressure = clamp((V.optionalFinite(couplingPressures['flicker-trust'], 0) - 0.74) / 0.18, 0, 1);
      // R8 E4: Lowered FP containment threshold from 0.72 to 0.45 and widened
      // divisor from 0.16 to 0.25. FP correlation was the only persistent
      // increasing correlation (R6: 0.421, R7: 0.473) with no containment
      // activating until 0.72. The new threshold begins gentle containment at
      // FP > 0.45, graduating to full pressure at 0.70.
      const flickerPhasePressure = clamp((V.optionalFinite(couplingPressures['flicker-phase'], 0) - 0.45) / 0.25, 0, 1);
      const phaseRecoveryCredit = clamp((phaseShare - 0.09) / 0.05, 0, 1);
      const evolvingShare = dynamicSnap && typeof dynamicSnap.evolvingShare === 'number'
        ? dynamicSnap.evolvingShare
        : 0;
      const evolvingRecoveryPressure = clamp((0.055 - evolvingShare) / 0.055, 0, 1);
      const needsSoftPhaseRecovery = softPhaseDeficit > 0 && evolvingRecoveryPressure > 0.15;
      const phaseContainmentPressure = clamp((flickerPhasePressure * 0.55 + densityFlickerPressure * 0.35 + softPhaseDeficit * 0.10) * phaseRecoveryCredit, 0, 1);
      const phaseLanePriority = clamp((1 - densityFlickerPressure) * 0.45 + trustSharePressure * 0.35 + softPhaseDeficit * 0.20, 0, 1);
      if (textureDrift !== 0) {
        const scaledDrift = m.round(textureDrift * (1 - phaseContainmentPressure * 0.55));
        if ((textureDrift > 0 && scaledDrift > 0) || (textureDrift < 0 && scaledDrift < 0)) {
          offset += scaledDrift;
        }
      }
      const rescueContainmentPressure = clamp(densityFlickerPressure * 0.60 + densityTrustPressure * 0.25 + flickerTrustPressure * 0.15, 0, 1);
      const regimeAllowsPhaseRescue = snap && (snap.regime === 'exploring' || snap.regime === 'evolving' || (snap.regime === 'coherent' && (trustSharePressure > 0.35 || evolvingRecoveryPressure > 0.20)));
      const evolvingDecorrelateWindow = activeLayer === 'L2' && (phaseRecoveryCredit > 0.35 || softPhaseDeficit > 0.18) && evolvingRecoveryPressure > 0.20 && (densityFlickerPressure > 0.25 || flickerTrustPressure > 0.20);
      if (activeLayer === 'L2' && ((regimeAllowsPhaseRescue && (sectionProgress > 0.20 || textureStarved)) || needsPhaseRescue || needsSoftPhaseRecovery) && (deepPhaseCollapse || rescueContainmentPressure < 0.75 || phaseLanePriority > 0.55)) {
        const rescueTrim = clamp(1 - rescueContainmentPressure * (deepPhaseCollapse ? 0.30 : 0.60), 0.25, 1);
        const phasePush = m.max(1 + (deepPhaseCollapse ? 1 : 0), m.round((0.5 + sectionProgress) * rf(1.0, textureStarved ? 2.0 : 1.5) * (1 + lowPhasePressure * 0.75 + softPhaseDeficit * 0.55 + trustSharePressure * 0.45 + phaseLanePriority * 0.25 + (deepPhaseCollapse ? 0.35 : 0)) * rescueTrim * (1 - phaseContainmentPressure * (deepPhaseCollapse ? 0.10 : 0.45))));
        offset += phasePush;
      } else if (activeLayer === 'L1' && (needsPhaseRescue || (needsSoftPhaseRecovery && sectionProgress > 0.20)) && sectionProgress > 0.08) {
        const phasePush = m.max(
          1 + (deepPhaseCollapse ? 1 : 0),
          m.round((0.45 + sectionProgress * 0.55) * (1 + lowPhasePressure * 0.8 + softPhaseDeficit * 0.45 + rescueContainmentPressure * 0.30 + trustSharePressure * 0.30 + phaseLanePriority * 0.20 + (deepPhaseCollapse ? 0.25 : 0)) * (1 - phaseContainmentPressure * (deepPhaseCollapse ? 0.08 : 0.35)))
        );
        offset += phasePush;
      }
      if (evolvingDecorrelateWindow) {
        const decorrelationPush = m.max(1, m.round((0.5 + phaseRecoveryCredit * 0.6 + softPhaseDeficit * 0.45 + evolvingRecoveryPressure * 0.5) * (1 - rescueContainmentPressure * 0.55)));
        offset += decorrelationPush;
      }
    } catch { /* validation fallback */
      // Snapshot access is optional during early boot and tests.
      offset += textureDrift;
    }

    offset = ((offset % length) + length) % length; // Normalize to [0, length)

    // Rotate pattern by offset
    let rotated;
    try {
      rotated = rotate(pattern, offset, 'R', length);
    } catch (e) {
      throw new Error(`phaseLockedRhythmGenerator.generate: rotate() failed: ${e && e.message ? e.message : e}`);
    }

    V.assertArray(rotated, 'rotated');

    // Note: same pattern can legitimately be used at different lengths for different metrical levels
    // Phase tracking per (patternName, length) tuple allows this

    // Record generation for history
    generationHistory.push({
      patternName,
      length,
      offset,
    });

    return rotated;
  }

  /**
   * Lock pattern to specific phase offset
   * @param {string} patternName - Pattern name
   * @param {number} length - Pattern length (required for phase key tuple)
   * @param {number} phase - Phase offset to lock to
   * @throws {Error} if phase not a valid number
   */
  function lock(patternName, length, phase) {
    V.assertNonEmptyString(patternName, 'patternName');

    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`phaseLockedRhythmGenerator.lock: length must be positive integer, got ${length}`);
    }

    V.requireFinite(phase, 'phase');

    const phaseKeyBase = activeLayer ? `${activeLayer}:${patternName}` : patternName;
    const phaseKey = `${phaseKeyBase}:${length}`;
    phases.set(phaseKey, phase);
  }

  /**
   * Get current phase for a pattern
   * @param {string} patternName - Pattern name
   * @param {number} length - Pattern length (required for phase key tuple)
   * @returns {number} current phase offset (0 if not yet set)
   */
  function getPhase(patternName, length) {
    V.assertNonEmptyString(patternName, 'patternName');

    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`phaseLockedRhythmGenerator.getPhase: length must be positive integer, got ${length}`);
    }

    const phaseKeyBase = activeLayer ? `${activeLayer}:${patternName}` : patternName;
    const phaseKey = `${phaseKeyBase}:${length}`;
    return phases.get(phaseKey) ?? 0;
  }

  /**
   * Advance phase for a pattern (rotate by delta)
   * @param {string} patternName - Pattern name
   * @param {number} length - Pattern length (required for phase key tuple)
   * @param {number} delta - Amount to advance (can be negative)
   * @param {number} [modulo] - Wrap phase to this value (default: no wrap)
   * @throws {Error} if delta not a valid number
   */
  function advancePhase(patternName, length, delta, modulo = undefined) {
    V.assertNonEmptyString(patternName, 'patternName');

    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`phaseLockedRhythmGenerator.advancePhase: length must be positive integer, got ${length}`);
    }

    V.requireFinite(delta, 'delta');

    const current = getPhase(patternName, length);
    let newPhase = current + delta;

    if (typeof modulo === 'number' && modulo > 0) {
      newPhase = ((newPhase % modulo) + modulo) % modulo;
    }

    const phaseKeyBase = activeLayer ? `${activeLayer}:${patternName}` : patternName;
    const phaseKey = `${phaseKeyBase}:${length}`;
    phases.set(phaseKey, newPhase);
  }

  /**
   * Get phase relationship between two patterns
   * Useful for analyzing polyrhythmic interlocking
   * @param {string} patternA - First pattern name
   * @param {number} lengthA - First pattern length
   * @param {string} patternB - Second pattern name
   * @param {number} lengthB - Second pattern length
   * @returns {number} phase difference (B - A)
   */
  function getPhaseRelationship(patternA, lengthA, patternB, lengthB) {
    V.assertNonEmptyString(patternA, 'patternA');
    V.assertNonEmptyString(patternB, 'patternB');

    if (!Number.isInteger(lengthA) || lengthA <= 0 || !Number.isInteger(lengthB) || lengthB <= 0) {
      throw new Error(`phaseLockedRhythmGenerator.getPhaseRelationship: lengths must be positive integers (got ${lengthA}, ${lengthB})`);
    }

    const phaseA = getPhase(patternA, lengthA);
    const phaseB = getPhase(patternB, lengthB);
    return phaseB - phaseA;
  }

  /**
   * Clear all tracked phases
   */
  function reset() {
    phases.clear();
    generationHistory.length = 0;
  }

  /**
   * Get generation history (for analysis/debugging)
   * @returns {Array} recent generation records
   */
  function getHistory(limit = 50) {
    return generationHistory.slice(-limit);
  }

  return {
    generate,
    lock,
    getPhase,
    advancePhase,
    getPhaseRelationship,
    reset,
    getHistory,
    setActiveLayer,
    initializePolyrhythmCoupling
  };
})();
