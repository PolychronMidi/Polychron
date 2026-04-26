// src/crossLayer/velocityInterference.js - Cross-layer velocity phase interference.
// Posts velocity contour snapshots to ATG 'velocity' channel. When both layers
// are crescendoing toward the same ms point, velocities reinforce. When one
// crescendos while the other decrescendos, spectral separation increases.

moduleLifecycle.declare({
  name: 'velocityInterference',
  subsystem: 'crossLayer',
  deps: ['validator'],
  provides: ['velocityInterference'],
  crossLayerScopes: ['all'],
  init: (deps) => {
  const V = deps.validator.create('velocityInterference');
  const CHANNEL = 'velocity';
  const CONTOUR_WINDOW_MS = 400;
  const SYNC_TOLERANCE_MS = 300;
  const VIZ_CC = 102; // CC 102 = undefined in GM, safe for automation lane
  const VIZ_REINFORCE = 100; // CC value for reinforcement
  const VIZ_SEPARATE = 27;   // CC value for separation
  const VIZ_NEUTRAL = 64;    // CC value for neutral
  const MODE_SET = new Set(['reinforce', 'separate', 'neutral']);

  let cimScale = 0.5;

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  /**
   * Post a velocity contour sample from the active layer.
   * @param {number} absoluteSeconds - absolute ms
   * @param {string} layer - source layer
   * @param {number} velocity - current velocity 0-127
   * @param {number} delta - velocity change rate (positive = crescendo, negative = decrescendo)
   */
  function postVelocity(absoluteSeconds, layer, velocity, delta) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(layer, 'layer');
    const velocityN = V.requireFinite(velocity, 'velocity');
    const deltaN = V.requireFinite(delta, 'delta');
    L0.post(CHANNEL, layer, absoluteSeconds, {
      velocity: clamp(velocityN, 0, 127),
      delta: deltaN
    });
  }

  /**
   * Compute velocity delta from recent ATW note history.
   * @param {string} layer - layer to analyze
   * @param {number} absTimeSec - current absolute seconds
   * @returns {number} velocity delta (positive = getting louder)
   */
  function measureDelta(layer, absTimeSec) {
    V.assertNonEmptyString(layer, 'layer');
    const at = V.requireFinite(absTimeSec, 'absTimeSec');
    const windowSec = CONTOUR_WINDOW_MS / 1000;
    const bounds = L0.getBounds(L0_CHANNELS.note, {
      layer,
      since: at - windowSec,
      windowSeconds: windowSec
    });
    if (bounds.count < 2) return 0;
    const first = bounds.first;
    const last = bounds.last;
    V.assertObject(first, 'measureDelta.first');
    V.assertObject(last, 'measureDelta.last');
    const firstVelocity = V.requireFinite(first.velocity, 'measureDelta.first.velocity');
    const lastVelocity = V.requireFinite(last.velocity, 'measureDelta.last.velocity');
    return lastVelocity - firstVelocity;
  }

  /**
   * Compute interference modifier for a note's velocity.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} baseVelocity - the note's original velocity
   * @returns {{ velocity: number, mode: 'reinforce' | 'separate' | 'neutral' }}
   */
  function applyInterference(absoluteSeconds, activeLayer, baseVelocity) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const baseVelocityN = V.requireFinite(baseVelocity, 'baseVelocity');

    const other = L0.findClosest(
      CHANNEL, absoluteSeconds, SYNC_TOLERANCE_MS / 1000, activeLayer
    );
    if (!other) {
      writeVizCC(activeLayer, 'neutral');
      return { velocity: baseVelocityN, mode: 'neutral' };
    }
    V.assertObject(other, 'applyInterference.other');
    const otherDelta = V.requireFinite(other.delta, 'applyInterference.other.delta');

    // Get our own recent delta
    const absTimeSec = absoluteSeconds;
    const ourDelta = measureDelta(activeLayer, absTimeSec);

    // Same direction = reinforcement, opposite = separation
    const sameDirection = (ourDelta >= 0 && otherDelta >= 0) || (ourDelta < 0 && otherDelta < 0);

    // R71 E5: Section-progressive interference strength. In earlier sections,
    // cross-layer velocity interference is gentler (boost 10%, separation 6%).
    // As the piece progresses, interference strengthens (boost 20%, separation 12%),
    // creating more dynamic cross-layer interplay and coupling texture in later
    // sections (S1-S3 had zero exceedance in R70).
    // R77 E4: Increase base from 0.10/0.06 to 0.13/0.08 for stronger cross-layer
    // velocity interaction across all sections, improving dynamic range contrast.
    const sectionProg = totalSections > 1
      ? clamp(sectionIndex / (totalSections - 1), 0, 1)
      : 0.5;
    // R98 E2: Bell-curve interference concentration at compositional midpoint.
    // Stronger interference at midpoint supports tension arc peak.
    const midpointFocus = m.exp(-m.pow((sectionProg - 0.5) * 2.5, 2));
    // R91 E4: Regime-responsive interference scaling.
    const regime = regimeClassifier.getRegime();
    const regimeScale = regime === 'exploring' ? 1.20
      : regime === 'coherent' ? 0.85
      : 1.0;
    const cimFactor = 0.4 + cimScale * 1.2;
    // Melodic coupling: tessituraLoad amplifies interference in extreme registers.
    // High register extremity -> stronger velocity coordination between layers.
    // Comfortable register -> normal interference level.
    const melodicCtxVI = emergentMelodicEngine.getContext();
    const tessituraLoad = melodicCtxVI ? V.optionalFinite(melodicCtxVI.tessituraLoad, 0) : 0;
    const melodicIntensityScale = 1.0 + tessituraLoad * 0.25; // [1.0 comfortable ... 1.25 extreme]
    // R79 E3: freshnessEma coupling -- novel melodic intervals amplify interference strength.
    // Fresh territory produces stronger dynamic contrast: reinforcement louder, separation softer.
    const freshnessEmaVI = melodicCtxVI ? V.optionalFinite(melodicCtxVI.freshnessEma, 0.5) : 0.5;
    const freshnessIntensityScale = 1.0 + clamp(freshnessEmaVI - 0.40, 0, 0.60) * 0.25; // [1.0 familiar ... 1.15 novel]
    // Rhythmic coupling: unexpected density surge sharpens velocity interference. Decline surprises soften it.
    const rhythmEntryVI = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const densitySurpriseVI = rhythmEntryVI && Number.isFinite(rhythmEntryVI.densitySurprise) ? rhythmEntryVI.densitySurprise : 1.0;
    const rhythmInterferenceMod = densitySurpriseVI > 1.1 ? 1.12 : densitySurpriseVI < 0.9 ? 0.92 : 1.0;
    // R83 E1: ascendRatio bridge -- ascending melodic momentum amplifies velocity interference
    // (stronger dynamic contrast during upward energy). Counterpart: harmonicIntervalGuard
    // NARROWS deadband under same signal (harmony stabilizes during ascending momentum).
    const ascendRatioVI = melodicCtxVI ? V.optionalFinite(melodicCtxVI.ascendRatio, 0.5) : 0.5;
    const ascendInterferenceScale = 1.0 + clamp((ascendRatioVI - 0.45) * 0.25, -0.05, 0.12);
    // R86 E2: complexityEma antagonism bridge -- sustained rhythmic complexity amplifies velocity interference.
    // Counterpart: harmonicIntervalGuard NARROWS deadband under same signal (harmony stabilizes while dynamics intensify).
    const complexityEmaVI = rhythmEntryVI && Number.isFinite(rhythmEntryVI.complexityEma) ? rhythmEntryVI.complexityEma : 0.5;
    const complexityEmaInterferenceScale = 1.0 + clamp((complexityEmaVI - 0.45) * 0.20, -0.04, 0.10);
    // contourShape: rising arc = stronger velocity interference (dynamic contrast builds as energy climbs);
    // falling arc = softer interference (release phase convergences layers dynamically).
    const contourShapeVI = melodicCtxVI
      ? (melodicCtxVI.contourShape === 'rising' ? 1.07 : melodicCtxVI.contourShape === 'falling' ? 0.95 : 1.0)
      : 1.0;
    const boostCeiling = (0.13 + midpointFocus * 0.10) * regimeScale * cimFactor * melodicIntensityScale * freshnessIntensityScale * rhythmInterferenceMod * ascendInterferenceScale * complexityEmaInterferenceScale * contourShapeVI;
    const reductionCeiling = (0.08 + midpointFocus * 0.06) * regimeScale * cimFactor * melodicIntensityScale * freshnessIntensityScale * rhythmInterferenceMod * ascendInterferenceScale * complexityEmaInterferenceScale * contourShapeVI;

    if (sameDirection) {
      // Reinforce: boost velocity proportional to alignment strength
      const alignment = m.min(m.abs(ourDelta), m.abs(otherDelta));
      const boost = clamp(alignment / 30, 0, boostCeiling);
      const reinforced = crossLayerHelpers.scaleVelocity(baseVelocityN, 1 + boost);
      writeVizCC(activeLayer, 'reinforce');
      return { velocity: reinforced, mode: 'reinforce' };
    }

    // Opposing dynamics: reduce velocity to create spectral space
    const opposition = m.min(m.abs(ourDelta), m.abs(otherDelta));
    const reduction = clamp(opposition / 50, 0, reductionCeiling);
    const separated = crossLayerHelpers.scaleVelocity(baseVelocityN, 1 - reduction);
    writeVizCC(activeLayer, 'separate');
    return { velocity: separated, mode: 'separate' };
  }

  /**
   * Write a MIDI CC event for DAW visualization of interference mode.
   * @param {string} layer
   * @param {'reinforce'|'separate'|'neutral'} mode
   */
  function writeVizCC(layer, mode) {
    V.assertNonEmptyString(layer, 'writeVizCC.layer');
    V.assertInSet(mode, MODE_SET, 'writeVizCC.mode');
    V.assertArray(c, 'c');
    const ch = (layer === 'L1') ? cCH1 : cCH2;
    const val = mode === 'reinforce' ? VIZ_REINFORCE : mode === 'separate' ? VIZ_SEPARATE : VIZ_NEUTRAL;
    crossLayerEmissionGateway.emit('velocityInterference', c, { timeInSeconds: beatStartTime, type: 'control_c', vals: [ch, VIZ_CC, val] });
  }

  return { postVelocity, measureDelta, applyInterference, setCoordinationScale, reset() { /* stateless - no per-scope state to clear */ } };
  },
});
