// src/crossLayer/convergenceDetector.js — Polyrhythmic convergence detection.
// Posts every note onset to ATG 'onset' channel. When two layers' onsets land
// within a tight ms tolerance, that's a convergence point — triggers burst events.
// Burst = coordinated unison note cluster (same pitch class, octave-displaced)
// creating a momentary "singularity."

ConvergenceDetector = (() => {
  const V = Validator.create('ConvergenceDetector');
  const CHANNEL = 'onset';
  const CONVERGENCE_TOLERANCE_MS = 25;
  const MIN_CONVERGENCE_INTERVAL_MS = 500;
  const BURST_VOICES = 3;
  const BURST_STAGGER_RATIO = 0.008;
  const BURST_VEL_SCALE_MIN = 0.75;
  const BURST_VEL_SCALE_MAX = 1.1;

  let lastConvergenceMs = -Infinity;
  let totalConvergences = 0;

  /**
   * Post a note onset from the active layer.
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} midi - MIDI note number
   * @param {number} velocity - 0-127
   */
  function postOnset(absTimeMs, layer, midi, velocity) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, { midi, velocity });
  }

  /**
   * Check whether a convergence just occurred at this time point.
   * Returns null if no convergence, or a convergence descriptor.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @returns {{ syncTick: number, rarity: number, otherMidi: number, otherVelocity: number } | null}
   */
  function detect(absTimeMs, activeLayer) {
    V.requireFinite(absTimeMs, 'absTimeMs');

    // Throttle: don't fire convergence events more often than the interval
    if (absTimeMs - lastConvergenceMs < MIN_CONVERGENCE_INTERVAL_MS) return null;

    const match = AbsoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, CONVERGENCE_TOLERANCE_MS, activeLayer
    );
    if (!match) return null;

    lastConvergenceMs = absTimeMs;

    // Rarity: tighter alignment = higher rarity score (0-1)
    const dist = Math.abs(match.timeMs - absTimeMs);
    const rarity = 1 - (dist / CONVERGENCE_TOLERANCE_MS);

    // Convert to this layer's tick space
    V.requireFinite(measureStart, 'measureStart');
    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(tpSec, 'tpSec');
    const syncTick = Math.round(measureStart + ((match.timeMs / 1000) - measureStartTime) * tpSec);

    return {
      syncTick,
      rarity: clamp(rarity, 0, 1),
      otherMidi: match.midi || 0,
      otherVelocity: match.velocity || 0
    };
  }

  /**
   * Apply convergence effects: accent burst and velocity reinforcement.
   * Call from the main loop after each note emission.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} currentMidi - the note just played
   * @param {number} currentVelocity - the velocity just used
    * @returns {{ convergence: boolean, rarity: number, burstNotes: number[], totalConvergences: number } | null}
   */
  function applyIfConverged(absTimeMs, activeLayer, currentMidi, currentVelocity) {
    const conv = detect(absTimeMs, activeLayer);
    if (!conv) return null;

    totalConvergences++;

    // === BURST EVENT: coordinated unison singularity ===
    // Both notes share a pitch class; emit octave-displaced cluster
    const burstPC = currentMidi % 12;
    const burstBaseTick = conv.syncTick;
    const burstVel = Math.round(clamp(
      ((currentVelocity + conv.otherVelocity) / 2) * (0.9 + conv.rarity * 0.3),
      1, MIDI_MAX_VALUE
    ));
    // Pick octave spread based on rarity: rarer = wider spread
    const octaveSpread = conv.rarity > 0.7 ? 3 : conv.rarity > 0.4 ? 2 : 1;
    const burstNotes = [];
    for (let oi = -octaveSpread; oi <= octaveSpread; oi++) {
      const n = burstPC + (Math.round(currentMidi / 12) + oi) * 12;
      if (n >= (OCTAVE.min * 12 - 1) && n <= (OCTAVE.max * 12 - 1)) burstNotes.push(n);
    }
    // Limit to BURST_VOICES and schedule via p(c,...)
    while (burstNotes.length > BURST_VOICES) burstNotes.splice(ri(burstNotes.length - 1), 1);
    const burstSustain = tpSec * rf(0.15, 0.5) * (0.5 + conv.rarity * 0.5);
    const primaryCh = (activeLayer === 'L1') ? cCH1 : cCH2;
    for (let bi = 0; bi < burstNotes.length; bi++) {
      const stagger = tpSec * BURST_STAGGER_RATIO * bi;
      const bv = Math.round(clamp(burstVel * rf(BURST_VEL_SCALE_MIN, BURST_VEL_SCALE_MAX), 1, MIDI_MAX_VALUE));
      p(c, { tick: burstBaseTick + stagger, type: 'on', vals: [primaryCh, burstNotes[bi], bv] });
      p(c, { tick: burstBaseTick + stagger + burstSustain, vals: [primaryCh, burstNotes[bi]] });
    }

    // Emit convergence event for conductor/other subsystems to react
    if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') {
      EventBus.emit('CROSS_LAYER_CONVERGENCE', {
        layer: activeLayer,
        rarity: conv.rarity,
        syncTick: conv.syncTick,
        noteA: currentMidi,
        noteB: conv.otherMidi,
        velocityA: currentVelocity,
        velocityB: conv.otherVelocity,
        burstNotes,
        burstVel,
        totalConvergences,
        absTimeMs
      });
    }

    return { convergence: true, rarity: conv.rarity, burstNotes, totalConvergences };
  }

  /** @returns {number} total convergences fired so far */
  function getConvergenceCount() { return totalConvergences; }

  /** Reset state (e.g. between sections). */
  function reset() {
    lastConvergenceMs = -Infinity;
    totalConvergences = 0;
  }

  return { postOnset, detect, applyIfConverged, getConvergenceCount, reset };
})();
