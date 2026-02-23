// src/crossLayer/convergenceDetector.js — Polyrhythmic convergence detection.
// Posts every note onset to ATG 'onset' channel. When two layers' onsets land
// within a tight ms tolerance, that's a convergence point — triggers burst events.
// Burst = coordinated unison note cluster (same pitch class, octave-displaced)
// creating a momentary "singularity."

ConvergenceDetector = (() => {
  const V = Validator.create('convergenceDetector');
  const CHANNEL = 'onset';
  const EVENTS = EventCatalog.names;
  const CONVERGENCE_TOLERANCE_MS = 50;
  const MIN_CONVERGENCE_INTERVAL_MS = 500;
  const BURST_VOICES = 3;
  const BURST_STAGGER_RATIO = 0.008;
  const BURST_VEL_SCALE_MIN = 0.75;
  const BURST_VEL_SCALE_MAX = 1.1;

  let lastConvergenceMs = -Infinity;
  let totalConvergences = 0;
  /** @type {Record<string, number>} */
  const lastConvergenceByLayer = {};

  /**
   * Post a note onset from the active layer.
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} midi - MIDI note number
   * @param {number} velocity - 0-127
   */
  function postOnset(absTimeMs, layer, midi, velocity) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.requireFinite(midi, 'midi');
    V.requireFinite(velocity, 'velocity');
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, {
      midi: clamp(Math.round(midi), 0, 127),
      velocity: clamp(Math.round(velocity), 1, MIDI_MAX_VALUE)
    });
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
    const syncTickRaw = Math.round(measureStart + ((match.timeMs / 1000) - measureStartTime) * tpSec);
    const syncTick = Math.max(0, syncTickRaw);

    return {
      syncTick,
      rarity: clamp(rarity, 0, 1),
      otherMidi: clamp(Math.round(V.requireFinite(match.midi, 'match.midi')), 0, 127),
      otherVelocity: clamp(Math.round(V.requireFinite(match.velocity, 'match.velocity')), 1, MIDI_MAX_VALUE)
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
    V.requireFinite(currentMidi, 'currentMidi');
    V.requireFinite(currentVelocity, 'currentVelocity');
    const conv = detect(absTimeMs, activeLayer);
    if (!conv) return null;

    totalConvergences++;
    lastConvergenceByLayer[activeLayer] = absTimeMs;

    // === BURST EVENT: coordinated unison singularity ===
    // Both notes share a pitch class; emit octave-displaced cluster
    const boundedCurrentMidi = clamp(Math.round(currentMidi), 0, 127);
    const burstPC = ((boundedCurrentMidi % 12) + 12) % 12;
    const burstBaseTick = conv.syncTick;
    const burstVel = Math.round(clamp(
      ((currentVelocity + conv.otherVelocity) / 2) * (0.9 + conv.rarity * 0.3),
      1, MIDI_MAX_VALUE
    ));
    // Pick octave spread based on rarity: rarer = wider spread
    const octaveSpread = conv.rarity > 0.7 ? 3 : conv.rarity > 0.4 ? 2 : 1;
    const burstNotes = [];
    const lo = Math.max(0, OCTAVE.min * 12);
    const hi = Math.min(127, OCTAVE.max * 12 - 1);
    for (let oi = -octaveSpread; oi <= octaveSpread; oi++) {
      const n = burstPC + (Math.round(boundedCurrentMidi / 12) + oi) * 12;
      if (n >= lo && n <= hi) burstNotes.push(n);
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
    EventBus.emit(EVENTS.CROSS_LAYER_CONVERGENCE, {
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

    return { convergence: true, rarity: conv.rarity, burstNotes, totalConvergences };
  }

  /**
   * Whether this layer had a convergence within the given lookback window.
   * @param {number} absTimeMs
   * @param {string} layer
   * @param {number} [windowMs=250]
   * @returns {boolean}
   */
  function wasRecent(absTimeMs, layer, windowMs) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    const window = V.optionalFinite(windowMs, 250);
    const lastMs = Number(lastConvergenceByLayer[layer]);
    if (!Number.isFinite(lastMs)) return false;
    return (absTimeMs - lastMs) <= Math.max(0, window);
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
    lastConvergenceMs = -Infinity;
    totalConvergences = 0;
    Object.keys(lastConvergenceByLayer).forEach((layer) => {
      delete lastConvergenceByLayer[layer];
    });
  }

  return { postOnset, detect, applyIfConverged, wasRecent, getLastConvergenceMs, getConvergenceCount, reset };
})();
CrossLayerRegistry.register('ConvergenceDetector', ConvergenceDetector, ['all', 'phrase']);
