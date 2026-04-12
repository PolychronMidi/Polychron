grooveTransfer = (() => {
  const V = validator.create('grooveTransfer');
  const CHANNEL = 'grooveTransfer';
  const MAX_OFFSETS = 64;
  const DAMPING = 0.55;
  const LAYER_SET = new Set(['L1', 'L2']);

  let cimScale = 0.5;

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  /** @type {Map<string, number[]>} */
  const offsetsByLayer = new Map();
  /** @type {Map<string, number>} running sum per layer for O(1) average */
  const sumByLayer = new Map();

  /** @param {string} layer */
  function ensure(layer) {
    V.assertNonEmptyString(layer, 'layer');
    if (!offsetsByLayer.has(layer)) {
      offsetsByLayer.set(layer, []);
      sumByLayer.set(layer, 0);
    }
    const arr = offsetsByLayer.get(layer);
    if (!arr) throw new Error('grooveTransfer: failed to initialize layer offsets for ' + layer);
    return arr;
  }

  /** @param {'beat'|'div'|'subdiv'|'subsubdiv'|string} unit */
  function getUnitStartTime(unit) {
    V.assertNonEmptyString(unit, 'unit');
    if (unit === 'beat') return V.requireFinite(beatStartTime, 'beatStartTime');
    if (unit === 'div') return V.requireFinite(divStartTime, 'divStartTime');
    if (unit === 'subdiv') return V.requireFinite(subdivStartTime, 'subdivStartTime');
    if (unit === 'subsubdiv') return V.requireFinite(subsubdivStartTime, 'subsubdivStartTime');
    return V.requireFinite(beatStartTime, 'beatStartTime');
  }

  /**
   * @param {string} layer
   * @param {number} timeSec - onset time in seconds
   * @param {string} unit
   */
  function recordTiming(layer, timeSec, unit) {
    V.assertNonEmptyString(layer, 'recordTiming.layer');
    const timeInSeconds = V.requireFinite(timeSec, 'recordTiming.timeSec');
    V.assertNonEmptyString(unit, 'recordTiming.unit');
    const base = getUnitStartTime(unit);
    const offset = timeInSeconds - base;
    const row = ensure(layer);
    row.push(offset);
    sumByLayer.set(layer, V.optionalFinite(sumByLayer.get(layer), 0) + offset);
    if (row.length > MAX_OFFSETS) {
      sumByLayer.set(layer, V.optionalFinite(sumByLayer.get(layer), 0) - row[0]);
      row.shift();
    }

    L0.post(CHANNEL, layer, timeInSeconds, { offset, unit });
  }

  /**
   * @param {string} layer
   * @param {number} timeSec - onset time in seconds
   * @param {string} unit
   */
  function applyOffset(layer, timeSec, unit) {
    V.assertInSet(layer, LAYER_SET, 'applyOffset.layer');
    const timeInSeconds = V.requireFinite(timeSec, 'applyOffset.timeSec');
    V.assertNonEmptyString(unit, 'applyOffset.unit');

    const otherLayer = crossLayerHelpers.getOtherLayer(layer);
    const other = ensure(otherLayer);
    if (other.length === 0) return timeInSeconds;

    const avg = V.optionalFinite(sumByLayer.get(otherLayer), 0) / other.length;

    let localTransfer = avg;
    const closest = L0.findClosest(CHANNEL, timeInSeconds, 0.120, layer);
    if (closest) {
      V.assertObject(closest, 'applyOffset.closest');
      const closestOffset = V.requireFinite(closest.offset, 'applyOffset.closest.offset');
      const closestUnit = V.assertNonEmptyString(closest.unit, 'applyOffset.closest.unit');
      if (closestUnit === unit) {
        localTransfer = (avg * 0.5) + (closestOffset * 0.5);
      }
    }

    // Coherence-responsive groove coupling: good coherence = tighter coupling, poor = looser
    const coherenceEntry = L0.getLast(L0_CHANNELS.coherence, { layer: 'both' });
    const coherenceFactor = coherenceEntry ? clamp(0.8 + V.optionalFinite(coherenceEntry.bias, 1.0) * 0.4, 0.7, 1.3) : 1.0;
    // Melodic coupling: intervalFreshness controls groove independence vs. convergence.
    // Novel intervals -> layers explore independently (more damping = less groove transfer).
    // Stale intervals -> layers converge into shared groove (less damping = more transfer).
    const melodicCtxGT = emergentMelodicEngine.getContext();
    const intervalFreshness = melodicCtxGT ? V.optionalFinite(melodicCtxGT.intervalFreshness, 0.5) : 0.5;
    const melodicDampingScale = 0.8 + intervalFreshness * 0.4; // [0.8 stale ... 1.2 fresh]
    // R87 E1: registerMigrationDir antagonism bridge with climaxEngine -- ascending pitch center
    // tightens groove transfer (rhythmic independence while register climbs toward structural peak).
    // Counterpart: climaxEngine ACCELERATES climax approach under same signal (arc intensifies).
    const registerDirGT = melodicCtxGT ? melodicCtxGT.registerMigrationDir : null;
    const registerTransferScale = registerDirGT === 'ascending' ? 0.88 : registerDirGT === 'descending' ? 1.10 : 1.0;
    // Rhythmic coupling: complex cross-layer rhythm = layers creating structure together -> amplify transfer.
    const rhythmEntryGT = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const rhythmComplexityGT = rhythmEntryGT && Number.isFinite(rhythmEntryGT.complexity) ? rhythmEntryGT.complexity : 0;
    const rhythmDampingMod = 1.0 + rhythmComplexityGT * 0.12; // [1.0-1.12] complex->stronger transfer
    // R88 E2: complexityEma antagonism bridge with stutterContagion -- sustained rhythmic complexity
    // dampens groove transfer (complex self-organizing texture doesn't need cross-layer bleed).
    // Counterpart: stutterContagion AMPLIFIES spread under same signal (chaos cascades while groove stabilizes).
    const complexityEmaGT = rhythmEntryGT && Number.isFinite(rhythmEntryGT.complexityEma) ? rhythmEntryGT.complexityEma : 0.5;
    const complexityTransferScale = 1.0 - clamp((complexityEmaGT - 0.45) * 0.15, 0, 0.08);
    // R89 E3: biasStrength antagonism bridge with feedbackOscillator -- confident rhythm pulse amplifies groove transfer
    // (strong shared pulse = reliable groove = layers synchronize timing feel more strongly).
    // Counterpart: feedbackOscillator DAMPENS impulse energy under same signal (groove established, oscillation calms).
    const biasStrengthGT = rhythmEntryGT && Number.isFinite(rhythmEntryGT.biasStrength) ? rhythmEntryGT.biasStrength : 0;
    const biasTransferScale = 1.0 + clamp((biasStrengthGT - 0.30) * 0.20, 0, 0.09);
    // R90 E2: tessituraLoad antagonism bridge with crossLayerClimaxEngine -- extreme register reduces groove transfer
    // (layers in extreme register explore independent rhythmic territory, shared groove loosens).
    // Counterpart: crossLayerClimaxEngine ACCELERATES climax approach under same signal (structural arc crests at extremes).
    const tessituraLoadGT = melodicCtxGT ? V.optionalFinite(melodicCtxGT.tessituraLoad, 0) : 0;
    const tessituraTransferScale = 1.0 - clamp(tessituraLoadGT * 0.15, 0, 0.08);
    // contourShape: rising arc = layers explore independent timing (consistent with ascending register reducing transfer);
    // falling arc = layers settle into shared groove (mutual timing convergence in descent).
    const contourTransferScale = melodicCtxGT
      ? (melodicCtxGT.contourShape === 'rising' ? 0.94 : melodicCtxGT.contourShape === 'falling' ? 1.06 : 1.0)
      : 1.0;
    const effectiveDamping = DAMPING * (1.3 - cimScale * 0.6) * melodicDampingScale * rhythmDampingMod * registerTransferScale * complexityTransferScale * biasTransferScale * tessituraTransferScale * contourTransferScale;
    return timeInSeconds + localTransfer * effectiveDamping * coherenceFactor;
  }

  function reset() {
    offsetsByLayer.clear();
    sumByLayer.clear();
  }

  return { recordTiming, applyOffset, setCoordinationScale, reset };
})();
crossLayerRegistry.register('grooveTransfer', grooveTransfer, ['all', 'phrase']);
