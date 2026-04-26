// correlationShuffler.js - Feedback loop correlation detection and perturbation.
// Detects pathological correlations between registered feedback loops (reinforcement
// spirals, tug-of-war, stasis lock) and applies graduated shuffle interventions
// to break them. Inversely health-gated: shuffles MORE under stress since
// correlation lock may be the cause of the stress.

moduleLifecycle.declare({
  name: 'correlationShuffler',
  subsystem: 'conductor',
  deps: [],
  provides: ['correlationShuffler'],
  init: () => {
  const S = hyperMetaManagerState.S;

  const WINDOW_SIZE = 80;
  const CORRELATION_THRESHOLD = 0.65;
  const ANTI_CORRELATION_THRESHOLD = -0.65;
  const STASIS_THRESHOLD = 0.05;
  const STASIS_WINDOW = 100;
  const MIN_SHUFFLE_INTERVAL = 40;
  const SHUFFLE_RECOVERY_WINDOW = 12;
  const SHUFFLE_CONFIDENCE_ALPHA = 0.08;

  // Per-loop rolling history of (amplitude, phase) snapshots
  /** @type {Map<string, { amplitudes: number[], phases: number[] }>} */
  const history = new Map();
  // Correlation matrix: Map<'loopA:loopB', { phaseCorr: number, ampCorr: number }>
  /** @type {Map<string, { phaseCorr: number, ampCorr: number, beatsSinceChange: number }>} */
  const correlations = new Map();
  // Active shuffle interventions
  /** @type {Map<string, { type: string, target: string, scale: number, expiresAt: number }>} */
  const activeShuffles = new Map();
  let lastShuffleBeat = -Infinity;
  let shuffleConfidence = 0.5;
  let healthBeforeShuffle = 0.7;
  let stasisBeats = 0;
  let totalShuffles = 0;

  /**
   * Record current snapshot from feedbackRegistry into rolling history.
   */
  function recordSnapshot() {
    const snap = feedbackRegistry.getSnapshot();
    for (const [name, data] of Object.entries(snap)) {
      if (!history.has(name)) {
        history.set(name, { amplitudes: [], phases: [] });
      }
      const h = /** @type {{ amplitudes: number[], phases: number[] }} */ (history.get(name));
      h.amplitudes.push(data.amplitude);
      h.phases.push(data.phase);
      if (h.amplitudes.length > WINDOW_SIZE) {
        h.amplitudes.shift();
        h.phases.shift();
      }
    }
  }

  /**
   * Compute Pearson correlation between two arrays.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} correlation [-1, 1]
   */
  function pearson(a, b) {
    const n = m.min(a.length, b.length);
    if (n < 10) return 0;
    let sumA = 0, sumB = 0;
    for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
    const meanA = sumA / n, meanB = sumB / n;
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA, db = b[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    const den = m.sqrt(denA * denB);
    return den < 1e-10 ? 0 : num / den;
  }

  /**
   * Update correlation matrix between all loop pairs.
   */
  function updateCorrelations() {
    const names = Array.from(history.keys());
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = names[i] + ':' + names[j];
        const ha = history.get(names[i]);
        const hb = history.get(names[j]);
        if (!ha || !hb) continue;
        const phaseCorr = pearson(ha.phases, hb.phases);
        const ampCorr = pearson(ha.amplitudes, hb.amplitudes);
        const prev = correlations.get(key);
        const beats = prev ? prev.beatsSinceChange + 1 : 1;
        const changed = prev && (m.abs(phaseCorr - prev.phaseCorr) > 0.15 || m.abs(ampCorr - prev.ampCorr) > 0.15);
        correlations.set(key, { phaseCorr, ampCorr, beatsSinceChange: changed ? 0 : beats });
      }
    }
  }

  /**
   * Detect stasis: all loops near-zero amplitude for extended period.
   * @returns {boolean}
   */
  function detectStasis() {
    let allFlat = true;
    for (const [, h] of history) {
      if (h.amplitudes.length < 20) { allFlat = false; continue; }
      const recent = h.amplitudes.slice(-20);
      const maxAmp = m.max(...recent);
      if (maxAmp > STASIS_THRESHOLD) { allFlat = false; break; }
    }
    if (allFlat) {
      stasisBeats++;
    } else {
      stasisBeats = 0;
    }
    return stasisBeats > STASIS_WINDOW;
  }

  /**
   * Detect pathological correlations and apply shuffle interventions.
   * Inversely health-gated: lower health = stronger shuffles.
   */
  function detectAndShuffle() {
    if (S.beatCount - lastShuffleBeat < MIN_SHUFFLE_INTERVAL) return;

    // Inverse health gating: stressed system gets MORE aggressive shuffles
    const healthScale = clamp(1.5 - S.healthEma, 0.5, 1.5);
    const confidenceScale = clamp(shuffleConfidence, 0.2, 1.0);
    const shuffleStrength = healthScale * confidenceScale;

    // Check for stasis lock
    if (detectStasis()) {
      applyStasisBreak(shuffleStrength);
      return;
    }

    // Check correlation pairs for pathological patterns
    for (const [key, corr] of correlations) {
      if (corr.beatsSinceChange < 40) continue;
      const [loopA, loopB] = key.split(':');
      const snap = feedbackRegistry.getSnapshot();
      const a = snap[loopA];
      const b = snap[loopB];
      if (!a || !b) continue;

      // Reinforcement spiral: same domain, same direction, high correlation
      if (a.target === b.target && corr.phaseCorr > CORRELATION_THRESHOLD) {
        applyPerturbation(loopA, loopB, 'reinforcement', shuffleStrength);
        break;
      }

      // Tug-of-war: same domain, opposite direction, high anti-correlation
      if (a.target === b.target && corr.phaseCorr < ANTI_CORRELATION_THRESHOLD) {
        applyTimingRotation(loopA, loopB, shuffleStrength);
        break;
      }

      // Cross-domain lock: different domains but amplitude locked together
      if (a.target !== b.target && corr.ampCorr > CORRELATION_THRESHOLD && corr.beatsSinceChange > 60) {
        applyMagnitudePerturbation(loopA, shuffleStrength);
        break;
      }
    }
  }

  /**
   * Reinforcement spiral intervention: scale down the stronger loop's
   * contribution temporarily to break phase lock.
   */
  function applyPerturbation(loopA, loopB, type, strength) {
    const snap = feedbackRegistry.getSnapshot();
    const stronger = (snap[loopA] && snap[loopB] && snap[loopA].amplitude > snap[loopB].amplitude) ? loopA : loopB;
    const scale = clamp(1.0 - strength * 0.3, 0.5, 0.95);
    const duration = m.round(8 + strength * 12);
    activeShuffles.set(stronger, {
      type, target: stronger, scale,
      expiresAt: S.beatCount + duration
    });
    healthBeforeShuffle = S.healthEma;
    lastShuffleBeat = S.beatCount;
    totalShuffles++;
  }

  /**
   * Tug-of-war intervention: add phase jitter to the weaker loop's timing,
   * breaking the anti-correlated lock.
   */
  function applyTimingRotation(loopA, loopB, strength) {
    const snap = feedbackRegistry.getSnapshot();
    const weaker = (snap[loopA] && snap[loopB] && snap[loopA].amplitude < snap[loopB].amplitude) ? loopA : loopB;
    const scale = clamp(0.7 + rf() * 0.3 * strength, 0.6, 1.1);
    const duration = m.round(10 + strength * 8);
    activeShuffles.set(weaker, {
      type: 'timing', target: weaker, scale,
      expiresAt: S.beatCount + duration
    });
    healthBeforeShuffle = S.healthEma;
    lastShuffleBeat = S.beatCount;
    totalShuffles++;
  }

  /**
   * Magnitude perturbation: temporarily jitter a loop's amplitude
   * to break cross-domain amplitude lock.
   */
  function applyMagnitudePerturbation(loopName, strength) {
    const scale = clamp(rf(0.7, 1.3) * strength, 0.5, 1.4);
    const duration = m.round(8 + strength * 10);
    activeShuffles.set(loopName, {
      type: 'magnitude', target: loopName, scale,
      expiresAt: S.beatCount + duration
    });
    healthBeforeShuffle = S.healthEma;
    lastShuffleBeat = S.beatCount;
    totalShuffles++;
  }

  /**
   * Stasis break: inject random amplitude perturbations into multiple loops.
   */
  function applyStasisBreak(strength) {
    const snap = feedbackRegistry.getSnapshot();
    const names = Object.keys(snap);
    const count = m.min(3, names.length);
    for (let i = 0; i < count; i++) {
      const idx = ri(names.length - 1);
      activeShuffles.set(names[idx], {
        type: 'stasis', target: names[idx],
        scale: rf(1.2, 1.8) * strength,
        expiresAt: S.beatCount + m.round(12 + strength * 15)
      });
    }
    stasisBeats = 0;
    healthBeforeShuffle = S.healthEma;
    lastShuffleBeat = S.beatCount;
    totalShuffles++;
  }

  /**
   * Get the current shuffle scale for a specific loop.
   * Called by feedbackRegistry.getResonanceDampening or directly by loops.
   * @param {string} loopName
   * @returns {number} multiplier (1.0 = no shuffle active)
   */
  function getShuffleScale(loopName) {
    const shuffle = activeShuffles.get(loopName);
    if (!shuffle) return 1.0;
    if (S.beatCount > shuffle.expiresAt) {
      activeShuffles.delete(loopName);
      return 1.0;
    }
    return shuffle.scale;
  }

  /**
   * Track recovery after shuffle: did health improve?
   * Updates shuffle confidence EMA.
   */
  function trackRecovery() {
    if (activeShuffles.size > 0) return;
    if (S.beatCount - lastShuffleBeat < SHUFFLE_RECOVERY_WINDOW) return;
    if (S.beatCount - lastShuffleBeat > SHUFFLE_RECOVERY_WINDOW + 5) return;

    const improved = S.healthEma > healthBeforeShuffle;
    const outcome = improved ? 0.8 : 0.2;
    shuffleConfidence += (outcome - shuffleConfidence) * SHUFFLE_CONFIDENCE_ALPHA;
  }

  /**
   * Clean up expired shuffles.
   */
  function expireShuffles() {
    for (const [name, shuffle] of activeShuffles) {
      if (S.beatCount > shuffle.expiresAt) activeShuffles.delete(name);
    }
  }

  /**
   * Main tick: called from hyperMetaManager on orchestration interval.
   */
  function tick() {
    recordSnapshot();
    updateCorrelations();
    expireShuffles();
    trackRecovery();
    detectAndShuffle();
  }

  function getSnapshot() {
    return {
      correlations: Object.fromEntries(correlations),
      activeShuffles: Object.fromEntries(activeShuffles),
      shuffleConfidence,
      stasisBeats,
      totalShuffles
    };
  }

  function reset() {
    history.clear();
    correlations.clear();
    activeShuffles.clear();
    lastShuffleBeat = -Infinity;
    shuffleConfidence = 0.5;
    healthBeforeShuffle = 0.7;
    stasisBeats = 0;
    totalShuffles = 0;
  }

  // Register as a closed-loop feedback controller
  {
    closedLoopController.create({
      name: 'correlationShuffler',
      observe: () => {
        const snap = getSnapshot();
        return clamp(Object.keys(snap.activeShuffles).length / 3, 0, 1);
      },
      target: () => 0.15,
      gain: 0.1,
      smoothing: 0.3,
      clampRange: [0.5, 1.5],
      sourceDomain: 'feedback_correlation',
      targetDomain: 'feedback_loop_dampening'
    });
  };

  return { tick, getShuffleScale, getSnapshot, reset };
  },
});
