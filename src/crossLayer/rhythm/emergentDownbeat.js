// src/crossLayer/emergentDownbeat.js - Emergent downbeat detection and accentuation.
// Neither layer has a "true" downbeat since they're polyrhythmic. But convergence
// points + cadence alignments + velocity reinforcements implicitly create perceived
// downbeats. Detect these emergent downbeats and lean into them: accent notes,
// add bass reinforcement, widen stereo field.

emergentDownbeat = (() => {
  const V = validator.create('emergentDownbeat');
  const CHANNEL = 'emergentDownbeat';
  const MIN_DOWNBEAT_INTERVAL_MS = 800;
  const ACCENT_VELOCITY_BOOST = 0.2; // 20% velocity increase
  const BASS_REINFORCE_OCTAVE = 2;   // add bass note 2 octaves below
  const STEREO_WIDEN_CC = 10;        // pan CC
  const STEREO_WIDEN_AMOUNT = 20;    // pan offset from center (6420)

  let lastDownbeatMs = -Infinity;
  let downbeatCount = 0;

  /**
   * @typedef {{ convergence: boolean, cadenceAlign: boolean, velReinforce: boolean, phaseLock: boolean }} DownbeatSignals
   */

  /**
   * Evaluate whether the current moment constitutes an emergent downbeat.
   * Combines multiple cross-layer signals into a single downbeat score.
   * @param {number} absTimeMs
   * @param {DownbeatSignals} signals - which cross-layer events just fired
   * @returns {{ isDownbeat: boolean, strength: number, signalCount: number } | null}
   */
  function detect(absTimeMs, signals) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    if (absTimeMs - lastDownbeatMs < MIN_DOWNBEAT_INTERVAL_MS) return null;

    // Count simultaneous signals
    let score = 0;
    let signalCount = 0;
    if (signals.convergence) { score += 0.4; signalCount++; }
    if (signals.cadenceAlign) { score += 0.3; signalCount++; }
    if (signals.velReinforce) { score += 0.2; signalCount++; }
    if (signals.phaseLock) { score += 0.15; signalCount++; }

    // Need at least 2 coincident signals and score > 0.4 for a downbeat
    if (signalCount < 2 || score < 0.4) return null;

    lastDownbeatMs = absTimeMs;
    downbeatCount++;

    // Post to ATG for other systems to see
    L0.post(CHANNEL, 'both', absTimeMs / 1000, { strength: score, signalCount });

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
   * Full emergent downbeat application: detect + accent + bass + stereo.
   * @param {number} absTimeMs
   * @param {string} layer
   * @param {DownbeatSignals} signals
   * @param {number} midi - current note
   * @param {number} velocity - current velocity
   * @returns {{ isDownbeat: boolean, accentedVelocity: number, strength: number } | null}
   */
  function applyIfDownbeat(absTimeMs, layer, signals, midi, velocity) {
    const result = detect(absTimeMs, signals);
    if (!result) return null;

    const av = accentVelocity(velocity, result.strength);
    reinforceBass(midi, av, result.strength);
    widenStereo(layer, result.strength);

    return { isDownbeat: true, accentedVelocity: av, strength: result.strength };
  }

  /** @returns {number} */
  function getDownbeatCount() { return downbeatCount; }

  function reset() {
    lastDownbeatMs = -Infinity;
    downbeatCount = 0;
  }

  return { detect, accentVelocity, reinforceBass, widenStereo, applyIfDownbeat, getDownbeatCount, reset };
})();
crossLayerRegistry.register('emergentDownbeat', emergentDownbeat, ['all']);
