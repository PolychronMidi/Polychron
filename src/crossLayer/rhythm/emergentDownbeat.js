// src/crossLayer/emergentDownbeat.js - Emergent downbeat detection and accentuation.
// Neither layer has a "true" downbeat since they're polyrhythmic. But convergence
// points + cadence alignments + velocity reinforcements implicitly create perceived
// downbeats. Detect these emergent downbeats and lean into them: accent notes,
// add bass reinforcement, widen stereo field.

emergentDownbeat = (() => {
  const V = validator.create('emergentDownbeat');
  const CHANNEL = 'emergentDownbeat';
  const MIN_DOWNBEAT_INTERVAL_SEC = 0.8;
  const ACCENT_VELOCITY_BOOST = 0.2; // 20% velocity increase
  const BASS_REINFORCE_OCTAVE = 2;   // add bass note 2 octaves below
  const STEREO_WIDEN_CC = 10;        // pan CC
  const STEREO_WIDEN_AMOUNT = 20;    // pan offset from center (6420)
  // Perceived tempo multiplier: sub-beat accent echoes at 2x/3x/4x feel
  const TEMPO_MULT_PROBABILITY = 0.25;
  const TEMPO_MULT_OPTIONS = [2, 3, 4];
  const TEMPO_MULT_LAYER_SWAP_PROB = 0.5;
  let cimScale = 0.5;

  let lastDownbeatSec = -Infinity;
  let downbeatCount = 0;

  /**
   * @typedef {{ convergence: boolean, cadenceAlign: boolean, velReinforce: boolean, phaseLock: boolean }} DownbeatSignals
   */

  /**
   * Evaluate whether the current moment constitutes an emergent downbeat.
   * Combines multiple cross-layer signals into a single downbeat score.
   * @param {number} absoluteSeconds
   * @param {DownbeatSignals} signals - which cross-layer events just fired
   * @returns {{ isDownbeat: boolean, strength: number, signalCount: number } | null}
   */
  function detect(absoluteSeconds, signals) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    // Melodic coupling: freshnessEma scales minimum interval between downbeats.
    // Fresh territory -> space out downbeats (let novel moments breathe uninterrupted).
    // Stale/familiar territory -> allow more frequent downbeats to punctuate monotony.
    const melodicCtxED = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const freshnessEma = melodicCtxED ? V.optionalFinite(melodicCtxED.freshnessEma, 0.5) : 0.5;
    const melodicInterval = MIN_DOWNBEAT_INTERVAL_SEC * (0.7 + freshnessEma * 0.6); // [0.7s fresh ... 1.3s stale]
    if (absoluteSeconds - lastDownbeatSec < melodicInterval) return null;

    // Count simultaneous signals
    let score = 0;
    let signalCount = 0;
    if (signals.convergence) { score += 0.4; signalCount++; }
    if (signals.cadenceAlign) { score += 0.3; signalCount++; }
    if (signals.velReinforce) { score += 0.2; signalCount++; }
    if (signals.phaseLock) { score += 0.15; signalCount++; }
    const recentTransition = L0.getLast('regimeTransition', { since: absoluteSeconds - 2, windowSeconds: 2 });
    if (recentTransition) { score += 0.25; signalCount++; }
    // R50: emergent rhythm grid density feeds back as a downbeat signal (completing the loop)
    const emergentEntry = L0.getLast('emergentRhythm', { layer: 'both' });
    if (emergentEntry && Number.isFinite(emergentEntry.density) && emergentEntry.density > 0.15) {
      score += clamp(emergentEntry.density * 0.2, 0, 0.15);
      signalCount++;
    }

    // convergenceTarget modulates detection threshold - more downbeats during climactic sections
    const intent = sectionIntentCurves.getLastIntent();
    const ct = V.optionalFinite(intent.convergenceTarget, 0.5);
    const scoreThreshold = 0.4 - ct * 0.1;
    if (signalCount < 2 || score < scoreThreshold) return null;

    lastDownbeatSec = absoluteSeconds;
    downbeatCount++;

    // Post to ATG for other systems to see
    L0.post(CHANNEL, 'both', absoluteSeconds, { strength: score, signalCount });

    return { isDownbeat: true, strength: clamp(score, 0, 1), signalCount };
  }

  /**
   * Apply emergent downbeat accentuation: velocity boost.
   * @param {number} velocity - original velocity
   * @param {number} strength - downbeat strength 0-1
   * @returns {number} boosted velocity
   */
  function accentVelocity(velocity, strength) {
    const boost = 1 + ACCENT_VELOCITY_BOOST * strength;
    return crossLayerHelpers.scaleVelocity(velocity, boost);
  }

  /**
   * Apply bass reinforcement at an emergent downbeat.
   * Emits a low bass note on cCH3 at the current tick.
   * @param {number} midi - the primary note being played
   * @param {number} velocity - the accented velocity
   * @param {number} strength - downbeat strength 0-1
   */
  function reinforceBass(midi, velocity, strength) {
    if (strength < 0.5) return; // only for strong downbeats

    const bassNote = (midi % 12) + BASS_REINFORCE_OCTAVE * 12;
    const { lo, hi } = crossLayerHelpers.getOctaveBounds();
    if (bassNote < lo || bassNote > hi) return;

    const bassVel = crossLayerHelpers.scaleVelocity(velocity, 0.7);
    const bassSustain = spBeat * rf(0.6, 1.2);
    crossLayerEmissionGateway.emit('emergentDownbeat', c, { timeInSeconds: beatStartTime, type: 'on', vals: [cCH3, bassNote, bassVel] });
    crossLayerEmissionGateway.emit('emergentDownbeat', c, { timeInSeconds: beatStartTime + bassSustain, vals: [cCH3, bassNote] });
  }

  /**
   * Apply stereo widening at emergent downbeats via pan CC.
   * Pushes source channels slightly wider for emphasis.
   * @param {string} layer - 'L1' or 'L2'
   * @param {number} strength - downbeat strength 0-1
   */
  function widenStereo(layer, strength) {
    if (strength < 0.4) return;

    const offset = m.round(STEREO_WIDEN_AMOUNT * strength);
    const leftCh = (layer === 'L1') ? lCH1 : lCH2;
    const rightCh = (layer === 'L1') ? rCH1 : rCH2;

    crossLayerEmissionGateway.emit('emergentDownbeat', c, { timeInSeconds: beatStartTime, type: 'control_c', vals: [leftCh, STEREO_WIDEN_CC, clamp(64 - offset, 0, 127)] });
    crossLayerEmissionGateway.emit('emergentDownbeat', c, { timeInSeconds: beatStartTime, type: 'control_c', vals: [rightCh, STEREO_WIDEN_CC, clamp(64 + offset, 0, 127)] });

    // Reset pan after a short duration
    const resetTime = beatStartTime + spBeat * 0.5;
    crossLayerEmissionGateway.emit('emergentDownbeat', c, { timeInSeconds: resetTime, type: 'control_c', vals: [leftCh, STEREO_WIDEN_CC, 64] });
    crossLayerEmissionGateway.emit('emergentDownbeat', c, { timeInSeconds: resetTime, type: 'control_c', vals: [rightCh, STEREO_WIDEN_CC, 64] });
  }

  /**
   * Apply perceived tempo multiplication: rapid sub-beat accent echoes
   * that create double/triple/quadruple time feel without changing actual
   * composition tempo. Half the time swaps which layer leads the accents.
   * @param {string} layer - originating layer
   * @param {number} midi - current note
   * @param {number} velocity - accented velocity
   * @param {number} strength - downbeat strength
   */
  function applyTempoMultiplier(layer, midi, velocity, strength) {
    if (strength < 0.45 || rf() > TEMPO_MULT_PROBABILITY) return;

    const mult = TEMPO_MULT_OPTIONS[ri(TEMPO_MULT_OPTIONS.length - 1)];
    const interval = spBeat / mult;
    // Half the time, swap to the other layer for the rapid accents
    // CIM: coordinated = less swapping (layers accent together), independent = more swapping
    const swapProb = TEMPO_MULT_LAYER_SWAP_PROB * (1.5 - cimScale);
    const swapLayer = rf() < swapProb;
    const targetLayer = swapLayer ? crossLayerHelpers.getOtherLayer(layer) : layer;
    const targetCh = targetLayer === 'L1' ? cCH1 : cCH2;

    const { lo, hi } = crossLayerHelpers.getOctaveBounds();
    const baseNote = clamp(midi, lo, hi);

    for (let i = 1; i < mult; i++) {
      const t = beatStartTime + interval * i;
      // Velocity decays per sub-accent: first is 85% of source, each subsequent 15% less
      const subVel = crossLayerHelpers.scaleVelocity(velocity, 0.85 - (i - 1) * 0.15);
      if (subVel < 15) continue;
      // Alternate between source pitch and octave shift for variety
      const note = (i % 2 === 0) ? baseNote : clamp(baseNote + (rf() < 0.5 ? 12 : -12), lo, hi);
      crossLayerEmissionGateway.emit('emergentDownbeat', c, { timeInSeconds: t, type: 'on', vals: [targetCh, note, subVel] });
      crossLayerEmissionGateway.emit('emergentDownbeat', c, { timeInSeconds: t + interval * 0.6, vals: [targetCh, note] });
    }
  }

  /**
   * Full emergent downbeat application: detect + accent + bass + stereo + tempo mult.
   * @param {number} absoluteSeconds
   * @param {string} layer
   * @param {DownbeatSignals} signals
   * @param {number} midi - current note
   * @param {number} velocity - current velocity
   * @returns {{ isDownbeat: boolean, accentedVelocity: number, strength: number } | null}
   */
  function applyIfDownbeat(absoluteSeconds, layer, signals, midi, velocity) {
    const result = detect(absoluteSeconds, signals);
    if (!result) return null;

    const av = accentVelocity(velocity, result.strength);
    reinforceBass(midi, av, result.strength);
    widenStereo(layer, result.strength);
    applyTempoMultiplier(layer, midi, av, result.strength);

    return { isDownbeat: true, accentedVelocity: av, strength: result.strength };
  }

  /** @returns {number} */
  function getDownbeatCount() { return downbeatCount; }

  function reset() {
    lastDownbeatSec = -Infinity;
    downbeatCount = 0;
  }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  return { detect, accentVelocity, reinforceBass, widenStereo, applyTempoMultiplier, applyIfDownbeat, setCoordinationScale, getDownbeatCount, reset };
})();
crossLayerRegistry.register('emergentDownbeat', emergentDownbeat, ['all']);
