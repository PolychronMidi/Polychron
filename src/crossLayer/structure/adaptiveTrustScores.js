adaptiveTrustScores = (() => {
  const V = validator.create('adaptiveTrustScores');
  /** @type {Map<string, { score: number, samples: number, lastMs: number }>} */
  const scoreBySystem = new Map();

  // Exploration bonus: starving systems get periodic positive nudges
  // to ensure they occasionally act and have a chance to prove their worth.
  const EXPLORATION_THRESHOLD = 0.10; // score below this triggers exploration
  const EXPLORATION_NUDGE     = 0.03; // small positive injection per decay cycle
  const EXPLORATION_INTERVAL  = 8;    // apply nudge every N decay cycles

  // Decay floor: scores cannot decay below this minimum. Prevents trust
  // from collapsing to near-zero for infrequently-active systems where
  // cumulative decay overwhelms sparse positive payoffs.
  const DECAY_FLOOR = 0.05;

  // Trust ceiling: prevents runaway dominance where high-trust systems
  // accumulate ever-more influence via positive feedback (high trust -
  // more influence - more positive outcomes - higher trust).
  const TRUST_CEILING = 0.75; // max score (- max weight - 1.56)
  let decayCycleCount = 0;

  // -- #5: Trust Starvation Auto-Nourishment (Hypermeta) --
  // Tracks per-system trust velocity EMA (rate of change). When velocity
  // is near zero for >100 beats, the system is stuck and receives a
  // synthetic payoff proportional to the gap from mean trust. This self-
  // heals the cadenceAlignment 0.122 starvation pattern without manual
  // threshold tweaking.
  const _VELOCITY_EMA_ALPHA = 0.02;         // ~50-beat horizon
  const _STAGNATION_THRESHOLD = 0.001;      // velocity below this is "stagnant"
  const _DISENGAGE_THRESHOLD = 0.003;       // R7 Evo 10: 3x threshold for hysteresis disengage
  const _DISENGAGE_BEATS = 50;              // R7 Evo 10: beats above disengage threshold before stopping
  const _STAGNATION_BEATS_TRIGGER = 100;    // beats of stagnation before nourishment
  const _BASE_NOURISHMENT_STRENGTH = 0.15;  // max synthetic payoff scaling
  const _MIN_NOURISHMENT_STRENGTH = 0.05;   // R7 Evo 10: floor after decay
  const _NOURISHMENT_DECAY = 0.90;          // R7 Evo 10: 10% decay per application
  /** @type {Map<string, { velocityEma: number, stagnantBeats: number, lastScore: number, disengageBeats: number, nourishmentCount: number, effectiveStrength: number }>} */
  const _velocityState = new Map();

  // -- Trust journal: ring buffer of significant trust changes --
  // Modeled after explainabilityBus. Keeps the most impactful trust
  // transitions across the entire run for post-hoc forensics.
  const JOURNAL_CAPACITY  = 200;
  const JOURNAL_EVICT     = 40;
  /** @type {{ section: number, beat: number, systemName: string, payoff: number, scoreBefore: number, scoreAfter: number, ms: number }[]} */
  const journal = [];
  // Only record outcomes whose |payoff| exceeds this threshold to avoid
  // flooding the journal with routine micro-adjustments.
  const JOURNAL_PAYOFF_THRESHOLD = 0.15;

  // R9 Evo 4: Warm-start overrides for systems that need early trust to
  // accumulate signal (e.g. cadenceAlignment needs phrase boundaries).
  const WARM_START = {
    cadenceAlignment: 0.25
  };

  /** @param {string} systemName */
  function ensure(systemName) {
    V.assertNonEmptyString(systemName, 'systemName');
    if (!scoreBySystem.has(systemName)) {
      const initScore = WARM_START[systemName] !== undefined ? WARM_START[systemName] : 0;
      scoreBySystem.set(systemName, { score: initScore, samples: 0, lastMs: 0 });
    }
    const state = scoreBySystem.get(systemName);
    if (!state) throw new Error('adaptiveTrustScores: failed to initialize state for ' + systemName);
    return state;
  }

  /**
   * @param {string} systemName
   * @param {number} payoff - -1..1
   */
  function registerOutcome(systemName, payoff) {
    V.requireFinite(payoff, 'payoff');
    const state = ensure(systemName);
    const p = clamp(payoff, -1, 1);
    const scoreBefore = state.score;
    state.score = clamp(state.score * 0.9 + p * 0.1, -1, TRUST_CEILING);
    state.samples += 1;
    state.lastMs = beatStartTime * 1000;

    // Journal significant trust changes for post-run forensics.
    if (m.abs(p) >= JOURNAL_PAYOFF_THRESHOLD) {
      if (journal.length >= JOURNAL_CAPACITY) journal.splice(0, JOURNAL_EVICT);
      journal.push({
        section: sectionIndex,
        beat: beatCount,
        systemName,
        payoff: p,
        scoreBefore,
        scoreAfter: state.score,
        ms: state.lastMs
      });
    }

    explainabilityBus.emit('trust-update', 'both', {
      systemName,
      payoff: p,
      score: state.score,
      samples: state.samples
    }, state.lastMs);

    return state.score;
  }

  const TRUST_WEIGHT_MULTIPLIER = 0.75;
  const TRUST_WEIGHT_MIN = 0.4;
  const TRUST_WEIGHT_MAX = 1.8;

  /** @param {string} systemName */
  function getWeight(systemName) {
    const state = ensure(systemName);
    let effectiveScore = state.score;
    // R13 Evo 1: Cadence Alignment Trust Minimum
    if (systemName === trustSystems.names.CADENCE_ALIGNMENT && effectiveScore < 0.20) effectiveScore = 0.20;
    // R13 Evo 5: Stutter Weight Dampening
    if (systemName === trustSystems.names.STUTTER_CONTAGION && effectiveScore > 0.55) effectiveScore = 0.55;
    return clamp(1 + effectiveScore * TRUST_WEIGHT_MULTIPLIER, TRUST_WEIGHT_MIN, TRUST_WEIGHT_MAX);
  }

  /** @param {number} [rate=0.01] */
  function decayAll(rate) {
    const decayRate = clamp(V.optionalFinite(rate, 0.01), 0, 1);
    decayCycleCount++;
    const applyExploration = (decayCycleCount % EXPLORATION_INTERVAL) === 0;

    // Health-aware exploration: when signalHealthAnalyzer reports trust as
    // strained or worse, double the exploration nudge to accelerate recovery
    // of dormant systems. Wires adaptiveTrustScores into the health self-
    // healing loop without creating a new feedback mechanism.
    let effectiveNudge = EXPLORATION_NUDGE;
    const trustGrade = safePreBoot.call(() => signalHealthAnalyzer.getHealth().trust.grade, 'healthy');
    if (trustGrade === 'strained' || trustGrade === 'stressed' || trustGrade === 'critical') {
      effectiveNudge = EXPLORATION_NUDGE * 2;
    }

    for (const state of scoreBySystem.values()) {
      state.score *= (1 - decayRate);

      // Decay floor: prevent trust collapse for established systems
      if (state.samples > 16 && state.score < DECAY_FLOOR) {
        state.score = DECAY_FLOOR;
      }

      // Exploration bonus: periodically nudge starving systems toward neutral
      // so they occasionally earn enough trust to act via negotiationEngine.
      if (applyExploration && state.score < EXPLORATION_THRESHOLD && state.samples > 16) {
        state.score = clamp(state.score + effectiveNudge, -1, 1);
      }
    }

    // -- #5: Trust starvation auto-nourishment --
    // Detect per-system velocity stagnation and inject synthetic payoff
    // to break out of trust plateaus.
    let meanTrust = 0;
    let trustCountForMean = 0;
    for (const state of scoreBySystem.values()) {
      meanTrust += state.score;
      trustCountForMean++;
    }
    meanTrust = trustCountForMean > 0 ? meanTrust / trustCountForMean : 0;

    for (const [name, state] of scoreBySystem.entries()) {
      let vs = _velocityState.get(name);
      if (!vs) {
        vs = { velocityEma: 0, stagnantBeats: 0, lastScore: state.score, disengageBeats: 0, nourishmentCount: 0, effectiveStrength: _BASE_NOURISHMENT_STRENGTH };
        _velocityState.set(name, vs);
      }
      const scoreDelta = m.abs(state.score - vs.lastScore);
      vs.velocityEma = vs.velocityEma * (1 - _VELOCITY_EMA_ALPHA) + scoreDelta * _VELOCITY_EMA_ALPHA;
      vs.lastScore = state.score;

      // R7 Evo 10: Hysteresis - engage at threshold, disengage at 3x threshold
      if (vs.velocityEma < _STAGNATION_THRESHOLD) {
        vs.stagnantBeats++;
        vs.disengageBeats = 0;
      } else if (vs.velocityEma > _DISENGAGE_THRESHOLD) {
        vs.disengageBeats++;
        if (vs.disengageBeats >= _DISENGAGE_BEATS) {
          vs.stagnantBeats = 0;
          vs.disengageBeats = 0;
        }
      } else {
        // In between thresholds: hold current state (hysteresis band)
        vs.disengageBeats = 0;
      }

      if (vs.stagnantBeats >= _STAGNATION_BEATS_TRIGGER && state.samples > 32) {
        const gap = meanTrust - state.score;
        if (gap > 0) {
          const syntheticPayoff = clamp(gap * vs.effectiveStrength, 0, 0.10);
          state.score = clamp(state.score + syntheticPayoff, -1, TRUST_CEILING);
          vs.stagnantBeats = 0;
          // R7 Evo 10: Decay nourishment strength per application to prevent trust inflation
          vs.nourishmentCount++;
          vs.effectiveStrength = m.max(_MIN_NOURISHMENT_STRENGTH, vs.effectiveStrength * _NOURISHMENT_DECAY);
          explainabilityBus.emit('trust-nourishment', 'both', {
            systemName: name,
            syntheticPayoff,
            gapFromMean: gap,
            newScore: state.score,
            nourishmentCount: vs.nourishmentCount,
            effectiveStrength: vs.effectiveStrength
          });
        }
      }
    }
  }

  function getSnapshot() {
    const snapshot = {};
    for (const [name, state] of scoreBySystem.entries()) {
      snapshot[name] = {
        score: state.score,
        samples: state.samples,
        weight: getWeight(name)
      };
    }
    return snapshot;
  }

  /** @returns {{ section: number, beat: number, systemName: string, payoff: number, scoreBefore: number, scoreAfter: number, ms: number }[]} */
  function getJournal() {
    return journal.slice();
  }

  function reset() {
    scoreBySystem.clear();
    decayCycleCount = 0;
    journal.length = 0;
    _velocityState.clear();
  }

  return { registerOutcome, getWeight, decayAll, getSnapshot, getJournal, reset };
})();
crossLayerRegistry.register('adaptiveTrustScores', adaptiveTrustScores, ['all']);
