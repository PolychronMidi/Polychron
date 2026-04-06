// src/crossLayer/convergenceDetector.js - Polyrhythmic convergence detection.
// Posts every note onset to ATG 'onset' channel. When two layers' onsets land
// within a tight ms tolerance, that's a convergence point - triggers burst events.
// Burst = coordinated unison note cluster (same pitch class, octave-displaced)
// creating a momentary "singularity."

convergenceDetector = (() => {
  const V = validator.create('convergenceDetector');
  const CHANNEL = 'onset';
  const EVENTS = eventCatalog.names;
  const CONVERGENCE_TOLERANCE_SEC = 0.05;
  const MIN_CONVERGENCE_INTERVAL_SEC = 0.5;

  let cimScale = 0.5;

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }
  const BURST_VOICES = 3;
  const BURST_STAGGER_RATIO = 0.008;
  const BURST_VEL_SCALE_MIN = 0.75;
  const BURST_VEL_SCALE_MAX = 1.1;

  let lastConvergenceSec = -Infinity;
  let totalConvergences = 0;
  // R33: convergence momentum -- rapid convergences build momentum that lowers
  // the effective interval (stickier detection). Self-regulating: momentum
  // decays when convergences are sparse, builds when they cluster.
  let convergenceMomentum = 0;
  const MOMENTUM_BUILD = 0.25;
  const MOMENTUM_DECAY = 0.02;
  /** @type {Record<string, number>} */
  const lastConvergenceByLayer = {};

  /**
   * Post a note onset from the active layer.
   * @param {number} absoluteSeconds - absolute ms
   * @param {string} layer - source layer
   * @param {number} midi - MIDI note number
   * @param {number} velocity - 0-127
   */
  function postOnset(absoluteSeconds, layer, midi, velocity) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.requireFinite(midi, 'midi');
    V.requireFinite(velocity, 'velocity');
    L0.post(CHANNEL, layer, absoluteSeconds, {
      midi: clamp(m.round(midi), 0, 127),
      velocity: clamp(m.round(velocity), 1, MIDI_MAX_VALUE)
    });
  }

  /**
   * Check whether a convergence just occurred at this time point.
   * Returns null if no convergence, or a convergence descriptor.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @returns {{ rarity: number, otherMidi: number, otherVelocity: number } | null}
   */
  function detect(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');

    // Modulate tolerance and interval by convergenceTarget from section intent
    const intent = sectionIntentCurves.getLastIntent();
    const ct = V.requireFinite(intent.convergenceTarget, 'intent.convergenceTarget');
    // Read current entropy from L0 - high entropy environments benefit from convergence moments
    const entropyEntry = L0.getLast('entropy', { layer: activeLayer });
    const currentEntropy = V.optionalFinite(entropyEntry ? entropyEntry.smoothed : NaN, 0.5);
    const entropyBoost = clamp((currentEntropy - 0.5) * 0.4, 0, 0.2);
    // Recent regime transition = natural convergence opportunity
    const recentRegimeTransition = L0.getLast('regimeTransition', { since: absoluteSeconds - 3, windowSeconds: 3 });
    const transitionBoost = recentRegimeTransition ? 0.15 : 0;
    // Poor coherence = convergence helps recalibrate
    const coherenceEntry = L0.getLast('coherence', { layer: 'both' });
    const coherenceBoost = coherenceEntry ? clamp(m.abs(V.optionalFinite(coherenceEntry.bias, 1.0) - 1.0) * 0.3, 0, 0.1) : 0;
    // R33: climax approach widens tolerance (pull layers together during peaks)
    const climaxEntry = L0.getLast('climax-pressure', { layer: 'both' });
    const climaxBoost = climaxEntry && Number.isFinite(climaxEntry.level) ? clamp(climaxEntry.level * 0.15, 0, 0.1) : 0;
    // R50: emergent rhythm density widens tolerance (rhythmic activity = natural convergence opportunity)
    const emergentEntry = L0.getLast('emergentRhythm', { layer: 'both' });
    const emergentBoost = emergentEntry && Number.isFinite(emergentEntry.density) ? clamp(emergentEntry.density * 0.2, 0, 0.12) : 0;
    // R57: melodic contour modulates convergence tolerance. Rising -> widen (ascending together).
    // Contrary counterpoint -> narrow (layers pulling apart, convergence harder).
    // Stale intervals -> slight widen (fresh unison after staleness = dramatic).
    const melodicCtxCD = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const melodicBoostCD = melodicCtxCD
      ? clamp(
        (melodicCtxCD.contourShape === 'rising' ? 0.08 : melodicCtxCD.contourShape === 'falling' ? -0.03 : 0)
        + (melodicCtxCD.counterpoint === 'contrary' ? -0.07 : 0)
        + (melodicCtxCD.intervalFreshness < 0.45 ? 0.04 : 0),
        -0.10, 0.10)
      : 0;
    const effectiveTolerance = CONVERGENCE_TOLERANCE_SEC * (0.6 + ct * 0.8 + entropyBoost + transitionBoost + coherenceBoost + climaxBoost + emergentBoost + melodicBoostCD) * (0.6 + cimScale * 0.8);
    const effectiveInterval = MIN_CONVERGENCE_INTERVAL_SEC * (1.4 - ct * 0.8 - entropyBoost * 0.5 - transitionBoost * 0.3 - coherenceBoost * 0.2);

    // R33: convergence momentum -- recent convergences make the next one easier
    // R72: complexityEma coupling -- complex rhythms sustain convergence momentum longer.
    const rhythmComplexEmaCD = emergentEntry && Number.isFinite(emergentEntry.complexityEma) ? emergentEntry.complexityEma : 0;
    convergenceMomentum = m.max(0, convergenceMomentum - MOMENTUM_DECAY * (1.0 - rhythmComplexEmaCD * 0.30));
    const momentumScale = 1.0 - clamp(convergenceMomentum * 0.3, 0, 0.25);
    if (absoluteSeconds - lastConvergenceSec < effectiveInterval * momentumScale) return null;

    const match = L0.findClosest(
      CHANNEL, absoluteSeconds, effectiveTolerance, activeLayer
    );
    if (!match) return null;

    lastConvergenceSec = absoluteSeconds;
    convergenceMomentum = clamp(convergenceMomentum + MOMENTUM_BUILD, 0, 1);

    // Rarity: tighter alignment = higher rarity score (0-1)
    const dist = m.abs(match.timeInSeconds - absoluteSeconds);
    const rarity = 1 - (dist / CONVERGENCE_TOLERANCE_SEC);

    return {
      rarity: clamp(rarity, 0, 1),
      otherMidi: clamp(m.round(V.requireFinite(match.midi, 'match.midi')), 0, 127),
      otherVelocity: clamp(m.round(V.requireFinite(match.velocity, 'match.velocity')), 1, MIDI_MAX_VALUE)
    };
  }

  /**
   * Apply convergence effects: accent burst and velocity reinforcement.
   * Call from the main loop after each note emission.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} currentMidi - the note just played
   * @param {number} currentVelocity - the velocity just used
    * @returns {{ convergence: boolean, rarity: number, burstNotes: number[], totalConvergences: number } | null}
   */
  function applyIfConverged(absoluteSeconds, activeLayer, currentMidi, currentVelocity) {
    V.requireFinite(currentMidi, 'currentMidi');
    V.requireFinite(currentVelocity, 'currentVelocity');
    const conv = detect(absoluteSeconds, activeLayer);
    if (!conv) return null;

    totalConvergences++;
    lastConvergenceByLayer[activeLayer] = absoluteSeconds;

    // === BURST EVENT: coordinated unison singularity ===
    // Both notes share a pitch class; emit octave-displaced cluster
    const boundedCurrentMidi = clamp(m.round(currentMidi), 0, 127);
    const burstPC = ((boundedCurrentMidi % 12) + 12) % 12;
    const burstBaseTime = absoluteSeconds;
    const intentForBurst = sectionIntentCurves.getLastIntent();
    const ctForBurst = V.requireFinite(intentForBurst.convergenceTarget, 'intentForBurst.convergenceTarget');
    const burstVel = m.round(clamp(
      ((currentVelocity + conv.otherVelocity) / 2) * (0.8 + ctForBurst * 0.2 + conv.rarity * 0.3),
      1, MIDI_MAX_VALUE
    ));
    // Pick octave spread based on rarity: rarer = wider spread
    const octaveSpread = conv.rarity > 0.7 ? 3 : conv.rarity > 0.4 ? 2 : 1;
    const burstNotes = [];
    const { lo, hi } = crossLayerHelpers.getOctaveBounds({ lowOffset: 0, clipToMidi: true });
    for (let oi = -octaveSpread; oi <= octaveSpread; oi++) {
      const n = burstPC + (m.round(boundedCurrentMidi / 12) + oi) * 12;
      if (n >= lo && n <= hi) burstNotes.push(n);
    }
    // Limit to BURST_VOICES and schedule via p(c,...)
    while (burstNotes.length > BURST_VOICES) burstNotes.splice(ri(burstNotes.length - 1), 1);
    const burstSustain = spBeat * rf(0.15, 0.5) * (0.5 + conv.rarity * 0.5);
    const primaryCh = (activeLayer === 'L1') ? cCH1 : cCH2;
    for (let bi = 0; bi < burstNotes.length; bi++) {
      const stagger = spBeat * BURST_STAGGER_RATIO * bi;
      const bv = m.round(clamp(burstVel * rf(BURST_VEL_SCALE_MIN, BURST_VEL_SCALE_MAX), 1, MIDI_MAX_VALUE));
      crossLayerEmissionGateway.emit('convergenceDetector', c, { timeInSeconds: burstBaseTime + stagger, type: 'on', vals: [primaryCh, burstNotes[bi], bv] });
      crossLayerEmissionGateway.emit('convergenceDetector', c, { timeInSeconds: burstBaseTime + stagger + burstSustain, vals: [primaryCh, burstNotes[bi]] });
    }

    // No active listeners - emitted for eventCatalog completeness and future extensibility
    eventBus.emit(EVENTS.CROSS_LAYER_CONVERGENCE, {
      layer: activeLayer,
      rarity: conv.rarity,
      noteA: currentMidi,
      noteB: conv.otherMidi,
      velocityA: currentVelocity,
      velocityB: conv.otherVelocity,
      burstNotes,
      burstVel,
      totalConvergences,
      absoluteSeconds
    });

    return { convergence: true, rarity: conv.rarity, burstNotes, totalConvergences };
  }

  /**
   * Whether this layer had a convergence within the given lookback window.
   * @param {number} absoluteSeconds
   * @param {string} layer
   * @param {number} [windowMs=250]
   * @returns {boolean}
   */
  function wasRecent(absoluteSeconds, layer, windowMs) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    const window = V.optionalFinite(windowMs, 250);
    const lastSec = Number(lastConvergenceByLayer[layer]);
    if (!Number.isFinite(lastSec)) return false;
    return (absoluteSeconds - lastSec) <= m.max(0, window / 1000);
  }

  /**
   * @param {string} layer
   * @returns {number}
   */
  function getLastConvergenceMs(layer) {
    const value = Number(lastConvergenceByLayer[layer]);
    return V.optionalFinite(value, -Infinity);
  }

  /** @returns {number} total convergences fired so far */
  function getConvergenceCount() { return totalConvergences; }

  /** Reset state (e.g. between sections). */
  function reset() {
    lastConvergenceSec = -Infinity;
    totalConvergences = 0;
    Object.keys(lastConvergenceByLayer).forEach((layer) => {
      delete lastConvergenceByLayer[layer];
    });
  }

  return { postOnset, detect, applyIfConverged, wasRecent, getLastConvergenceMs, getConvergenceCount, setCoordinationScale, reset };
})();
crossLayerRegistry.register('convergenceDetector', convergenceDetector, ['all', 'phrase']);
