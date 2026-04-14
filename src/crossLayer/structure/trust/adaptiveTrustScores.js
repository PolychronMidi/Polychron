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
  let cimScale = 0.5;

  // Trust ceiling: prevents runaway dominance where high-trust systems
  // accumulate ever-more influence via positive feedback (high trust -
  // more influence - more positive outcomes - higher trust).
  const TRUST_CEILING = 0.75; // max score (- max weight - 1.56)

  const BASE_EMA_DECAY = 0.85; // R33 E2: 0.9->0.85 faster trust adaptation
  const BASE_EMA_NEW = 0.15;  // R33 E2: 0.1->0.15 faster learning rate
  // R95 E2: Regime-responsive EMA learning rate
  const EMA_NEW_REGIME = { exploring: 0.20, evolving: 0.15, coherent: 0.12 };

  let decayCycleCount = 0;

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
    [trustSystems.names.CADENCE_ALIGNMENT]: 0.25,
    [trustSystems.names.REST_SYNCHRONIZER]: 0.25  // break 3-generation stagnation at ~0.199
  };

  // Cross-run warm-start: restore terminal trust scores from previous run.
  // Clamped to [0.08, 0.60] to prevent extreme inherited states.
  const adaptiveTrustScoresLoadedScores = /** @type {Record<string, number>} */ ({});
  try {
    const _atsFs = require('fs');
    const _atsPath = require('path').join(process.cwd(), 'metrics', 'adaptive-state.json');
    if (_atsFs.existsSync(_atsPath)) {
      const _atsState = JSON.parse(_atsFs.readFileSync(_atsPath, 'utf8'));
      if (_atsState.trustScores && typeof _atsState.trustScores === 'object') {
        const _atsNames = Object.keys(_atsState.trustScores);
        for (let _i = 0; _i < _atsNames.length; _i++) {
          const _s = _atsState.trustScores[_atsNames[_i]];
          if (Number.isFinite(_s)) adaptiveTrustScoresLoadedScores[_atsNames[_i]] = clamp(_s, 0.08, 0.60);
        }
      }
    }
  } catch (_atsErr) { console.warn('Acceptable warning: adaptiveTrustScores: cross-run warm-start load failed:', _atsErr && _atsErr.message ? _atsErr.message : _atsErr); }

  function ensure(systemName) {
    V.assertNonEmptyString(systemName, 'systemName');
    if (!scoreBySystem.has(systemName)) {
      const initScore = adaptiveTrustScoresLoadedScores[systemName] !== undefined
        ? adaptiveTrustScoresLoadedScores[systemName]
        : (WARM_START[systemName] !== undefined ? WARM_START[systemName] : 0);
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
    const hotspotProfile = adaptiveTrustScoresHelpers.getSystemPairHotspotProfile(systemName);
    const trustSurfacePressure = V.optionalFinite(hotspotProfile.trustSurfacePressure, 0);
    const trustClusterPressure = clamp((V.optionalFinite(hotspotProfile.trustHotPairCount, 0)) > 1 ? trustSurfacePressure * 0.40 + 0.08 : 0, 0, 0.24);
    const trustSurfaceSystem = hotspotProfile.hotspotPairs.some(function(entry) { return entry && entry.pair && entry.pair.indexOf('trust') >= 0; }) || hotspotProfile.dominantPair.indexOf('trust') >= 0;
    const context = adaptiveTrustScoresCaching.resolveContext();

    let newWeight = BASE_EMA_NEW;
    let decayWeight = BASE_EMA_DECAY;
    // R95 E2: Regime-responsive EMA learning rate -- faster adaptation during exploring, slower during coherent
    const regimeForEma = conductorSignalBridge.getSignals().regime || null;
    if (regimeForEma && EMA_NEW_REGIME[regimeForEma] !== undefined) {
      newWeight = EMA_NEW_REGIME[regimeForEma];
      decayWeight = 1 - newWeight;
    }
    // R71 E1: Removed coupling matrix brake (was reading coupling data
    // directly to compute ad-hoc trust penalty -- same anti-pattern fixed in
    // R69 for 5 harmonic/dynamics modules). Trust weight decay is now managed
    // solely through the standard EMA path and trustSurfaceGainBrake below.
    // The hypermeta controller chain handles coupling-related pressure.
    // Trust Exceedance Limits (Starvation guard)
    // Clamp bottom to 0.10 instead of -1 so aggressive exponential drops don't permanently decouple modules.
    state.score = clamp(state.score * decayWeight + p * newWeight, 0.10, TRUST_CEILING);
    if (p > 0 && trustSurfaceSystem) {
      const trustSurfaceGainBrake = clamp(
        hotspotProfile.pressure * 0.12 +
        hotspotProfile.severePressure * 0.12 +
        trustSurfacePressure * 0.16 +
        trustClusterPressure * 0.20 +
        context.trustAxisPressure * 0.10,
        0,
        0.34
      );
      if (trustSurfaceGainBrake > 0) {
        state.score = scoreBefore + (state.score - scoreBefore) * (1 - trustSurfaceGainBrake);
      }
    }
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
      const contextualPayoff = p >= 0
        ? clamp(p * (1 - hotspotProfile.pressure * 0.30 - hotspotProfile.severePressure * 0.20 - trustSurfacePressure * 0.18 - trustClusterPressure * 0.18), -1, 1)
        : clamp(p * (1 + hotspotProfile.pressure * 0.35 + hotspotProfile.severePressure * 0.25 + trustSurfacePressure * 0.16 + trustClusterPressure * 0.16), -1, 1);
      contextualRecord(systemName, contextualPayoff);
    }

    state.samples += 1;
    state.lastMs = beatStartTime;

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

    adaptiveTrustScoresCaching.invalidateValueCaches();

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
    // Intentional hypermeta exemptions (structural, not tuning targets):
    // CADENCE_ALIGNMENT needs phrase boundaries to accumulate signal -- floor of 0.20 prevents
    // permanent starvation before it has enough samples. No controller manages this because
    // the starvation is sampling-rate-driven, not coupling-driven.
    // STUTTER_CONTAGION capped at 0.55 to prevent rhythmic overcrowding when stutter trust
    // compounds with high entropy. Structural ceiling that predates the controller chain.
    if (systemName === trustSystems.names.CADENCE_ALIGNMENT && effectiveScore < 0.20) effectiveScore = 0.20;
    if (systemName === trustSystems.names.STUTTER_CONTAGION && effectiveScore > 0.55) effectiveScore = 0.55;

    const maxWeight = getAdaptiveDominanceCaps(systemName, effectiveScore).weightCap;
    return clamp(1 + effectiveScore * TRUST_WEIGHT_MULTIPLIER, TRUST_WEIGHT_MIN, maxWeight);
  }

  /** @param {string} systemName */
  function getWeight(systemName) {
    const cached = adaptiveTrustScoresCaching.getWeightCached(systemName);
    if (cached !== undefined) return cached;
    const baseWeight = getBaseWeight(systemName);
    const pairAwareProfile = adaptiveTrustScoresHelpers.getSystemPairHotspotProfile(systemName);
    const trustSurfacePressure = V.optionalFinite(pairAwareProfile.trustSurfacePressure, 0);
    const trustClusterPressure = clamp((V.optionalFinite(pairAwareProfile.trustHotPairCount, 0)) > 1 ? trustSurfacePressure * 0.40 + 0.08 : 0, 0, 0.24);
    const contextualWeightGetter = contextualTrust ? V.optionalType(contextualTrust.getContextualWeight, 'function') : undefined;
    const contextualWeight = contextualWeightGetter ? contextualWeightGetter(systemName) : null;
    if (contextualWeight === null) {
      adaptiveTrustScoresCaching.setWeightCached(systemName, baseWeight);
      return baseWeight;
    }
    const blend = clamp(0.18 + pairAwareProfile.pressure * 0.32 + pairAwareProfile.severePressure * 0.28, 0.18, 0.65);
    const blendedWeight = baseWeight * (1 - blend) + contextualWeight * blend;
    let hotspotAwareWeight = pairAwareProfile.severePressure > 0.10
      ? m.min(baseWeight, blendedWeight)
      : blendedWeight;
    const context = adaptiveTrustScoresCaching.resolveContext();
    hotspotAwareWeight = adaptiveTrustScoresHelpers.applyTrustBrakes(
      systemName, pairAwareProfile, context, hotspotAwareWeight, trustClusterPressure, trustSurfacePressure
    );
    const resolvedWeight = clamp(hotspotAwareWeight, TRUST_WEIGHT_MIN, TRUST_WEIGHT_MAX);
    adaptiveTrustScoresCaching.setWeightCached(systemName, resolvedWeight);
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

    const currentTension = safePreBoot.call(() => conductorSignalBridge.getSignals().tension, 1.0);
    const resolvedTension = V.optionalFinite(currentTension, 1.0);
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
    // CIM: independent = more exploration nudge (keep all systems active),
    // coordinated = less nudge (let dominant systems stay dominant)
    let effectiveNudge = EXPLORATION_NUDGE * (1.5 - cimScale);
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

    // -- #5: Trust stagnation auto-nourishment --
    // Detect per-system velocity stagnation and inject synthetic payoff
    // to break out of trust plateaus.
    let meanTrust = 0;
    let trustCountForMean = 0;
    for (const state of scoreBySystem.values()) {
      meanTrust += state.score;
      trustCountForMean++;
    }
    meanTrust = trustCountForMean > 0 ? meanTrust / trustCountForMean : 0;
    const context = adaptiveTrustScoresCaching.resolveContext();

    adaptiveTrustScoresVelocityNourishment.runVelocityNourishment(scoreBySystem, meanTrust, context);

    // R36: trust ecosystem biodiversity -- when Gini is high (monopolistic),
    // create protected niches for bottom systems. Self-regulating: biodiversity
    // boost scales with Gini coefficient and decays as distribution equalizes.
    if (scoreBySystem.size > 5 && decayCycleCount % 8 === 0) {
      const allScores = [];
      for (const s of scoreBySystem.values()) allScores.push(s.score);
      allScores.sort((a, b) => a - b);
      const n = allScores.length;
      let giniSum = 0;
      for (let gi = 0; gi < n; gi++) giniSum += (2 * gi - n + 1) * allScores[gi];
      const gini = n > 1 ? giniSum / (n * allScores.reduce((a, b) => a + b, 0) + 1e-10) : 0;
      if (gini > 0.25) {
        const biodiversityBoost = clamp((gini - 0.25) * 0.08, 0, 0.03);
        const bottomThreshold = allScores[m.floor(n * 0.2)];
        for (const [, state] of scoreBySystem.entries()) {
          if (state.score <= bottomThreshold && state.samples > 16) {
            state.score = clamp(state.score + biodiversityBoost, -1, TRUST_CEILING);
          }
        }
      }
    }

    adaptiveTrustScoresCaching.invalidateValueCaches();
  }

  function copySnapshotMap(src) {
    const copy = {};
    const names = Object.keys(src);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const c = src[name];
      copy[name] = {
        score: c.score,
        samples: c.samples,
        weight: c.weight,
        hotspotPressure: c.hotspotPressure,
        dominantPair: c.dominantPair,
        hotspotPairs: c.hotspotPairs,
        severePressure: c.severePressure,
        severePair: c.severePair,
        trustSurfacePressure: c.trustSurfacePressure,
        trustHotPairCount: c.trustHotPairCount
      };
    }
    return copy;
  }

  function getSnapshot() {
    const cached = adaptiveTrustScoresCaching.getSnapshotCached();
    if (cached) return copySnapshotMap(cached);
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
        severePair: pairAwareProfile.severePair,
        trustSurfacePressure: V.optionalFinite(pairAwareProfile.trustSurfacePressure, 0),
        trustHotPairCount: V.optionalFinite(pairAwareProfile.trustHotPairCount, 0)
      };
    }
    adaptiveTrustScoresCaching.setSnapshotCached(snapshot);
    return copySnapshotMap(snapshot);
  }

  /** @returns {{ section: number, beat: number, systemName: string, payoff: number, scoreBefore: number, scoreAfter: number, ms: number }[]} */
  function getJournal() {
    return journal.slice();
  }

  function reset() {
    scoreBySystem.clear();
    decayCycleCount = 0;
    journal.length = 0;
    adaptiveTrustScoresVelocityNourishment.resetVelocityState();
    adaptiveTrustScoresCaching.resetCaches();
  }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  /** @returns {Record<string, number>} plain name->score map for cross-run persistence */
  function getScores() {
    const scores = /** @type {Record<string, number>} */ ({});
    for (const [name, state] of scoreBySystem.entries()) scores[name] = state.score;
    return scores;
  }

  return { registerOutcome, getBaseWeight, getWeight, getWeightBatch, decayAll, getSnapshot, getJournal, getScores, setCoordinationScale, reset };
})();
crossLayerRegistry.register('adaptiveTrustScores', adaptiveTrustScores, ['all']);
