adaptiveTrustScores = (() => {
  const V = validator.create('adaptiveTrustScores');
  /** @type {Map<string, { score: number, samples: number, lastMs: number }>} */
  const scoreBySystem = new Map();

  // Exploration bonus: starving systems get periodic positive nudges
  // to ensure they occasionally act and have a chance to prove their worth.
  const EXPLORATION_THRESHOLD = 0.10; // score below this triggers exploration
  const EXPLORATION_NUDGE     = 0.03; // small positive injection per decay cycle

  // Decay floor: scores cannot decay below this minimum. Prevents trust
  // from collapsing to near-zero for infrequently-active systems where
  // cumulative decay overwhelms sparse positive payoffs.
  const DECAY_FLOOR = 0.05;

  // Trust ceiling: prevents runaway dominance where high-trust systems
  // accumulate ever-more influence via positive feedback (high trust -
  // more influence - more positive outcomes - higher trust).
  const TRUST_CEILING = 0.75; // max score (- max weight - 1.56)

  const BASE_EMA_DECAY = 0.85; // R33 E2: 0.9->0.85 faster trust adaptation
  const BASE_EMA_NEW = 0.15;  // R33 E2: 0.1->0.15 faster learning rate

  let decayCycleCount = 0;

  // -- #5: Trust Starvation Auto-Nourishment (Hypermeta) --
  // Tracks per-system trust velocity EMA (rate of change). When velocity
  // is near zero for >100 beats, the system is stuck and receives a
  // synthetic payoff proportional to the gap from mean trust. This self-
  // heals the cadenceAlignment 0.122 starvation pattern without manual
  // threshold tweaking.
  const _VELOCITY_EMA_ALPHA = 0.02;         // ~50-beat horizon
  const _STAGNATION_THRESHOLD = 0.001;      // velocity below this is "stagnant"
  const _DISENGAGE_THRESHOLD = 0.003;       // 3x threshold for hysteresis disengage
  const _DISENGAGE_BEATS = 50;              // beats above disengage threshold before stopping
  const _STAGNATION_BEATS_TRIGGER = 70;     // R33 E2: 100->70 faster recovery of stuck systems
  const _BASE_NOURISHMENT_STRENGTH = 0.15;  // max synthetic payoff scaling
  const _MIN_NOURISHMENT_STRENGTH = 0.05;   // floor after decay
  const _NOURISHMENT_DECAY = 0.90;          // 10% decay per application
  /** @type {Map<string, { velocityEma: number, stagnantBeats: number, lastScore: number, disengageBeats: number, nourishmentCount: number, effectiveStrength: number }>} */
  const adaptiveTrustScoresVelocityState = new Map();

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

  // Warm-start overrides for systems that need early trust to
  // accumulate signal (e.g. cadenceAlignment needs phrase boundaries).
  const WARM_START = {
    cadenceAlignment: 0.25,
    restSynchronizer: 0.25  // break 3-generation stagnation at ~0.199
  };

  let adaptiveTrustScoresCacheVersion = 0;
  let adaptiveTrustScoresContextCacheKey = '';
  let adaptiveTrustScoresContextCache = null;
  let adaptiveTrustScoresWeightCacheKey = '';
  const adaptiveTrustScoresWeightCache = new Map();
  let adaptiveTrustScoresSnapshotCacheKey = '';
  let adaptiveTrustScoresSnapshotCache = null;

  function adaptiveTrustScoresGetBeatKey() {
    const safeSection = Number.isFinite(sectionIndex) ? sectionIndex : -1;
    const safePhrase = Number.isFinite(phraseIndex) ? phraseIndex : -1;
    const safeBeat = Number.isFinite(beatStart) ? beatStart : (Number.isFinite(beatCount) ? beatCount : -1);
    return safeSection + ':' + safePhrase + ':' + safeBeat;
  }

  function adaptiveTrustScoresGetCacheKey() {
    return adaptiveTrustScoresGetBeatKey() + ':' + adaptiveTrustScoresCacheVersion;
  }

  function adaptiveTrustScoresInvalidateValueCaches() {
    adaptiveTrustScoresCacheVersion++;
    adaptiveTrustScoresWeightCacheKey = '';
    adaptiveTrustScoresWeightCache.clear();
    adaptiveTrustScoresSnapshotCacheKey = '';
    adaptiveTrustScoresSnapshotCache = null;
  }

  function adaptiveTrustScoresResolveContext() {
    const beatKey = adaptiveTrustScoresGetBeatKey();
    if (adaptiveTrustScoresContextCacheKey === beatKey && adaptiveTrustScoresContextCache) {
      return adaptiveTrustScoresContextCache;
    }
    const regime = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot().regime, 'evolving');
    const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    const tensionShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.tension === 'number'
      ? axisEnergy.shares.tension
      : 1.0 / 6.0;
    const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
      ? axisEnergy.shares.trust
      : 1.0 / 6.0;
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    adaptiveTrustScoresContextCacheKey = beatKey;
    adaptiveTrustScoresContextCache = {
      regime,
      tensionShare,
      trustShare,
      phaseShare,
      trustAxisPressure: clamp((trustShare - 0.17) / 0.08, 0, 1),
      phaseLaneNeed: clamp((0.07 - phaseShare) / 0.07, 0, 1)
    };
    return adaptiveTrustScoresContextCache;
  }

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

    let newWeight = BASE_EMA_NEW;
    let decayWeight = BASE_EMA_DECAY;
    // Trust Score Exponential Penalty
    if (p < 0) {
      const dynamics = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
      if (dynamics && dynamics.couplingMatrix) {
        let maxTrustCorr = 0;
        const pairs = ['tension-trust', 'density-trust', 'flicker-trust', 'entropy-trust', 'trust-phase'];
        for (let i = 0; i < pairs.length; i++) {
          const val = dynamics.couplingMatrix[pairs[i]];
          if (typeof val === 'number') {
             maxTrustCorr = m.max(maxTrustCorr, m.abs(val));
          }
        }
        if (maxTrustCorr > 0.70) {
          // exponential drop scalar when locking, maximum weight approaches 0.60
          newWeight = 0.1 * m.exp(5 * (maxTrustCorr - 0.70));
          newWeight = clamp(newWeight, 0.1, 0.6);
          decayWeight = 1 - newWeight;
        }
      }
    }
    // Trust Exceedance Limits (Starvation guard)
    // Clamp bottom to 0.10 instead of -1 so aggressive exponential drops don't permanently decouple modules.
    state.score = clamp(state.score * decayWeight + p * newWeight, 0.10, TRUST_CEILING);
    // trust ecosystem looks like, eliminating per-module floor additions.
    // Coefficient raised 0.30->0.50.
    //  Self-deriving coefficient from trust score standard deviation.
    // Widely dispersed scores (high stddev) get higher coefficient for stronger floor;
    // converged scores (low stddev) get lower coefficient for more differentiation.
    // coeff = clamp(0.30 + stddev * 1.8, 0.30, 0.60)
    if (scoreBySystem.size > 2) {
      const adaptiveTrustScoresScores = [];
      for (const s of scoreBySystem.values()) adaptiveTrustScoresScores.push(s.score);
      const adaptiveTrustScoresMean = adaptiveTrustScoresScores.reduce((a, b) => a + b, 0) / adaptiveTrustScoresScores.length;
      const adaptiveTrustScoresVariance = adaptiveTrustScoresScores.reduce((a, b) => a + (b - adaptiveTrustScoresMean) * (b - adaptiveTrustScoresMean), 0) / adaptiveTrustScoresScores.length;
      const adaptiveTrustScoresStddev = m.sqrt(adaptiveTrustScoresVariance);
      const adaptiveTrustScoresCoeff = clamp(0.30 + adaptiveTrustScoresStddev * 1.8, 0.30, 0.60);
      const adaptiveTrustScoresUniversalFloor = m.max(0.05, adaptiveTrustScoresMean * adaptiveTrustScoresCoeff);
      if (state.score < adaptiveTrustScoresUniversalFloor) state.score = adaptiveTrustScoresUniversalFloor;
    }
    const adaptiveCaps = getAdaptiveDominanceCaps(systemName, state.score);
    if (state.score > adaptiveCaps.scoreCeiling) {
      state.score = adaptiveCaps.scoreCeiling;
    }

    const contextualRecord = contextualTrust ? V.optionalType(contextualTrust.record, 'function') : undefined;
    if (contextualRecord) {
      const pairAwareProfile = adaptiveTrustScoresHelpers.getSystemPairHotspotProfile(systemName);
      const contextualPayoff = p >= 0
        ? clamp(p * (1 - pairAwareProfile.pressure * 0.30 - pairAwareProfile.severePressure * 0.20), -1, 1)
        : clamp(p * (1 + pairAwareProfile.pressure * 0.35 + pairAwareProfile.severePressure * 0.25), -1, 1);
      contextualRecord(systemName, contextualPayoff);
    }

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

    adaptiveTrustScoresInvalidateValueCaches();

    return state.score;
  }

  const TRUST_WEIGHT_MULTIPLIER = 0.75;
  const TRUST_WEIGHT_MIN = 0.4;
  const TRUST_WEIGHT_MAX = 1.8;
  function getAdaptiveDominanceCaps(systemName, effectiveScore) {
    return adaptiveTrustScoresHelpers.getAdaptiveDominanceCaps(scoreBySystem, systemName, effectiveScore, TRUST_CEILING, TRUST_WEIGHT_MAX);
  }

  /** @param {string} systemName */
  function getBaseWeight(systemName) {
    const state = ensure(systemName);
    let effectiveScore = state.score;
    // Cadence Alignment Trust Minimum
    if (systemName === trustSystems.names.CADENCE_ALIGNMENT && effectiveScore < 0.20) effectiveScore = 0.20;
    // Stutter Weight Dampening
    if (systemName === trustSystems.names.STUTTER_CONTAGION && effectiveScore > 0.55) effectiveScore = 0.55;

    const maxWeight = getAdaptiveDominanceCaps(systemName, effectiveScore).weightCap;
    return clamp(1 + effectiveScore * TRUST_WEIGHT_MULTIPLIER, TRUST_WEIGHT_MIN, maxWeight);
  }

  /** @param {string} systemName */
  function getWeight(systemName) {
    const cacheKey = adaptiveTrustScoresGetCacheKey();
    if (adaptiveTrustScoresWeightCacheKey !== cacheKey) {
      adaptiveTrustScoresWeightCacheKey = cacheKey;
      adaptiveTrustScoresWeightCache.clear();
    }
    if (adaptiveTrustScoresWeightCache.has(systemName)) {
      return adaptiveTrustScoresWeightCache.get(systemName);
    }
    const baseWeight = getBaseWeight(systemName);
    const pairAwareProfile = adaptiveTrustScoresHelpers.getSystemPairHotspotProfile(systemName);
    const contextualWeightGetter = contextualTrust ? V.optionalType(contextualTrust.getContextualWeight, 'function') : undefined;
    const contextualWeight = contextualWeightGetter ? contextualWeightGetter(systemName) : null;
    if (contextualWeight === null) {
      adaptiveTrustScoresWeightCache.set(systemName, baseWeight);
      return baseWeight;
    }
    const blend = clamp(0.18 + pairAwareProfile.pressure * 0.32 + pairAwareProfile.severePressure * 0.28, 0.18, 0.65);
    const blendedWeight = baseWeight * (1 - blend) + contextualWeight * blend;
    let hotspotAwareWeight = pairAwareProfile.severePressure > 0.10
      ? m.min(baseWeight, blendedWeight)
      : blendedWeight;
    const context = adaptiveTrustScoresResolveContext();
    const regime = context.regime;
    const tensionShare = context.tensionShare;
    const trustShare = context.trustShare;
    const phaseShare = context.phaseShare;
    if ((systemName === trustSystems.names.CADENCE_ALIGNMENT || systemName === trustSystems.names.CONVERGENCE)
      && regime === 'exploring'
      && (pairAwareProfile.dominantPair === 'density-trust' || (pairAwareProfile.dominantPair === 'density-flicker' && trustShare > 0.17))) {
      const densityTrustBrake = clamp(pairAwareProfile.pressure * 0.24 + pairAwareProfile.severePressure * 0.20 + clamp((trustShare - 0.17) / 0.07, 0, 1) * 0.10, 0.10, 0.34);
      hotspotAwareWeight *= 1 - densityTrustBrake;
    }
    if ((systemName === trustSystems.names.STUTTER_CONTAGION || systemName === trustSystems.names.REST_SYNCHRONIZER || systemName === trustSystems.names.COHERENCE_MONITOR)
      && (pairAwareProfile.dominantPair === 'flicker-trust' || pairAwareProfile.dominantPair === 'density-flicker' || pairAwareProfile.dominantPair === 'density-trust')) {
      const lowPhasePressure = clamp((0.05 - phaseShare) / 0.05, 0, 1);
      const trustAxisPressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
      const flickerTrustBrake = clamp(pairAwareProfile.pressure * 0.20 + pairAwareProfile.severePressure * 0.20 + lowPhasePressure * 0.14 + trustAxisPressure * 0.16, 0.08, 0.34);
      hotspotAwareWeight *= 1 - flickerTrustBrake;
    }
    if (systemName === trustSystems.names.ENTROPY_REGULATOR
      && (pairAwareProfile.dominantPair === 'entropy-trust' || pairAwareProfile.severePair === 'entropy-trust')) {
      const entropyTrustBrake = clamp(pairAwareProfile.pressure * 0.22 + pairAwareProfile.severePressure * 0.22 + clamp((trustShare - 0.15) / 0.06, 0, 1) * 0.08, 0.10, 0.30);
      hotspotAwareWeight *= 1 - entropyTrustBrake;
    }
    if ((systemName === trustSystems.names.CADENCE_ALIGNMENT || systemName === trustSystems.names.CONVERGENCE || systemName === trustSystems.names.COHERENCE_MONITOR)
      && regime === 'exploring'
      && pairAwareProfile.dominantPair === 'tension-trust') {
      const tensionTrustBrake = clamp(pairAwareProfile.pressure * 0.20 + pairAwareProfile.severePressure * 0.18 + clamp((tensionShare - 0.18) / 0.08, 0, 1) * 0.12, 0.10, 0.32);
      hotspotAwareWeight *= 1 - tensionTrustBrake;
    }
    if (trustShare > 0.17 && pairAwareProfile.pressure > 0.15) {
      const dominanceBrake = clamp(context.trustAxisPressure * 0.10 + context.phaseLaneNeed * 0.12 + pairAwareProfile.pressure * 0.08 + pairAwareProfile.severePressure * 0.08, 0, 0.28);
      hotspotAwareWeight *= 1 - dominanceBrake;
    }
    const resolvedWeight = clamp(hotspotAwareWeight, TRUST_WEIGHT_MIN, TRUST_WEIGHT_MAX);
    adaptiveTrustScoresWeightCache.set(systemName, resolvedWeight);
    return resolvedWeight;
  }

  /** @param {string[]} systemNames
   *  @returns {Record<string, number>}
   */
  function getWeightBatch(systemNames) {
    V.assertArray(systemNames, 'systemNames');
    const result = /** @type {Record<string, number>} */ ({});
    for (let i = 0; i < systemNames.length; i++) {
      const systemName = systemNames[i];
      V.assertNonEmptyString(systemName, 'systemNames[' + i + ']');
      result[systemName] = getWeight(systemName);
    }
    return result;
  }

  let lastTensionForExploration = 1.0;
  let accumulatedTensionDelta = 0;

  /** @param {number} [rate=0.01] */
  function decayAll(rate) {
    const decayRate = clamp(V.optionalFinite(rate, 0.01), 0, 1);
    decayCycleCount++;

    const currentTension = safePreBoot.call(() => signalReader.tension(), 1.0);
    const resolvedTension = typeof currentTension === 'number' ? currentTension : 1.0;
    accumulatedTensionDelta += m.abs(resolvedTension - lastTensionForExploration);
    lastTensionForExploration = resolvedTension;

    let applyExploration = false;
    // Tension auto-nourishment triggers explore when tension shifts significantly
    if (accumulatedTensionDelta >= 0.15 || decayCycleCount % 16 === 0) {
      applyExploration = true;
      accumulatedTensionDelta = 0;
    }

    // Health-aware exploration: when signalHealthAnalyzer reports trust as
    // strained or worse, double the exploration nudge to accelerate recovery
    // of dormant systems. Wires adaptiveTrustScores into the health self-
    // healing loop without creating a new feedback mechanism.
    let effectiveNudge = EXPLORATION_NUDGE;
    const trustGrade = safePreBoot.call(() => signalHealthAnalyzer.getHealth().trust.grade, 'healthy');
    if (trustGrade === 'strained' || trustGrade === 'stressed' || trustGrade === 'critical') {
      effectiveNudge = EXPLORATION_NUDGE * 2;
    }

    // Structural fix: Compute universal trust floor from population mean
    // before applying per-system decay. Replaces per-module hard-coded floors.
    // Coefficient raised 0.30->0.50 (matches registerOutcome change).
    // Self-deriving coefficient from trust score standard deviation.
    let adaptiveTrustScoresUniversalDecayFloor = 0.05;
    if (scoreBySystem.size > 2) {
      const adaptiveTrustScoresDScores = [];
      for (const s of scoreBySystem.values()) adaptiveTrustScoresDScores.push(s.score);
      const adaptiveTrustScoresDMean = adaptiveTrustScoresDScores.reduce((a, b) => a + b, 0) / adaptiveTrustScoresDScores.length;
      const adaptiveTrustScoresDVariance = adaptiveTrustScoresDScores.reduce((a, b) => a + (b - adaptiveTrustScoresDMean) * (b - adaptiveTrustScoresDMean), 0) / adaptiveTrustScoresDScores.length;
      const adaptiveTrustScoresDStddev = m.sqrt(adaptiveTrustScoresDVariance);
      const adaptiveTrustScoresDCoeff = clamp(0.30 + adaptiveTrustScoresDStddev * 1.8, 0.30, 0.60);
      adaptiveTrustScoresUniversalDecayFloor = m.max(0.05, adaptiveTrustScoresDMean * adaptiveTrustScoresDCoeff);
    }

    for (const [, state] of scoreBySystem.entries()) {
      state.score *= (1 - decayRate);

      // Decay floor: prevent trust collapse for established systems
      if (state.samples > 16 && state.score < DECAY_FLOOR) {
        state.score = DECAY_FLOOR;
      }

      // Structural fix: Universal population-derived trust floor (decay phase).
      // Computed once per decayAll call (above), applied per system.
      if (state.score < adaptiveTrustScoresUniversalDecayFloor) {
        state.score = adaptiveTrustScoresUniversalDecayFloor;
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
    const context = adaptiveTrustScoresResolveContext();
    const trustSharePressure = context.trustAxisPressure;
    const phaseLaneNeed = context.phaseLaneNeed;

    for (const [name, state] of scoreBySystem.entries()) {
      let vs = adaptiveTrustScoresVelocityState.get(name);
      if (!vs) {
        vs = { velocityEma: 0, stagnantBeats: 0, lastScore: state.score, disengageBeats: 0, nourishmentCount: 0, effectiveStrength: _BASE_NOURISHMENT_STRENGTH };
        adaptiveTrustScoresVelocityState.set(name, vs);
      }
      if (trustSharePressure > 0 && state.score > meanTrust) {
        const dominanceSurplus = clamp((state.score - meanTrust) / m.max(meanTrust, 0.05), 0, 1);
        const dominanceDecay = clamp(trustSharePressure * 0.025 + phaseLaneNeed * 0.03 + dominanceSurplus * 0.02, 0, 0.06);
        state.score *= 1 - dominanceDecay;
      }
      const scoreDelta = m.abs(state.score - vs.lastScore);
      vs.velocityEma = vs.velocityEma * (1 - _VELOCITY_EMA_ALPHA) + scoreDelta * _VELOCITY_EMA_ALPHA;
      vs.lastScore = state.score;

      // Hysteresis - engage at threshold, disengage at 3x threshold
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
          // Decay nourishment strength per application to prevent trust inflation
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

    adaptiveTrustScoresInvalidateValueCaches();
  }

  function getSnapshot() {
    const cacheKey = adaptiveTrustScoresGetCacheKey();
    if (adaptiveTrustScoresSnapshotCacheKey !== cacheKey || !adaptiveTrustScoresSnapshotCache) {
      const snapshot = {};
      for (const [name, state] of scoreBySystem.entries()) {
        const pairAwareProfile = adaptiveTrustScoresHelpers.getSystemPairHotspotProfile(name);
        snapshot[name] = {
          score: state.score,
          samples: state.samples,
          weight: getWeight(name),
          hotspotPressure: pairAwareProfile.pressure,
          dominantPair: pairAwareProfile.dominantPair,
          hotspotPairs: pairAwareProfile.hotspotPairs,
          severePressure: pairAwareProfile.severePressure,
          severePair: pairAwareProfile.severePair
        };
      }
      adaptiveTrustScoresSnapshotCacheKey = cacheKey;
      adaptiveTrustScoresSnapshotCache = snapshot;
    }
    const snapshotCopy = {};
    const names = Object.keys(adaptiveTrustScoresSnapshotCache);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const cached = adaptiveTrustScoresSnapshotCache[name];
      snapshotCopy[name] = {
        score: cached.score,
        samples: cached.samples,
        weight: cached.weight,
        hotspotPressure: cached.hotspotPressure,
        dominantPair: cached.dominantPair,
        hotspotPairs: cached.hotspotPairs,
        severePressure: cached.severePressure,
        severePair: cached.severePair
      };
    }
    return snapshotCopy;
  }

  /** @returns {{ section: number, beat: number, systemName: string, payoff: number, scoreBefore: number, scoreAfter: number, ms: number }[]} */
  function getJournal() {
    return journal.slice();
  }

  function reset() {
    scoreBySystem.clear();
    decayCycleCount = 0;
    journal.length = 0;
    adaptiveTrustScoresVelocityState.clear();
    adaptiveTrustScoresContextCacheKey = '';
    adaptiveTrustScoresContextCache = null;
    adaptiveTrustScoresInvalidateValueCaches();
  }

  return { registerOutcome, getBaseWeight, getWeight, getWeightBatch, decayAll, getSnapshot, getJournal, reset };
})();
crossLayerRegistry.register('adaptiveTrustScores', adaptiveTrustScores, ['all']);
