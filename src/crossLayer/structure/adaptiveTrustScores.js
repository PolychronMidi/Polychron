adaptiveTrustScores = (() => {
  const V = validator.create('adaptiveTrustScores');
  /** @type {Map<string, { score: number, samples: number, lastMs: number }>} */
  const scoreBySystem = new Map();

  // Exploration bonus: starving systems get periodic positive nudges
  // to ensure they occasionally act and have a chance to prove their worth.
  const EXPLORATION_THRESHOLD = 0.10; // score below this triggers exploration
  const EXPLORATION_NUDGE     = 0.03; // small positive injection per decay cycle
  const EXPLORATION_INTERVAL  = 8;    // apply nudge every N decay cycles

  // Trust ceiling: prevents runaway dominance where high-trust systems
  // accumulate ever-more influence via positive feedback (high trust →
  // more influence → more positive outcomes → higher trust).
  const TRUST_CEILING = 0.75; // max score (→ max weight ≈ 1.56)
  let decayCycleCount = 0;

  /** @param {string} systemName */
  function ensure(systemName) {
    V.assertNonEmptyString(systemName, 'systemName');
    if (!scoreBySystem.has(systemName)) {
      scoreBySystem.set(systemName, { score: 0, samples: 0, lastMs: 0 });
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
    state.score = clamp(state.score * 0.9 + p * 0.1, -1, TRUST_CEILING);
    state.samples += 1;
    state.lastMs = beatStartTime * 1000;

    explainabilityBus.emit('trust-update', 'both', {
      systemName,
      payoff: p,
      score: state.score,
      samples: state.samples
    }, state.lastMs);

    return state.score;
  }

  /** @param {string} systemName */
  function getWeight(systemName) {
    const state = ensure(systemName);
    return clamp(1 + state.score * 0.75, 0.4, 1.8);
  }

  /** @param {number} [rate=0.01] */
  function decayAll(rate) {
    const decayRate = clamp(V.optionalFinite(rate, 0.01), 0, 1);
    decayCycleCount++;
    const applyExploration = (decayCycleCount % EXPLORATION_INTERVAL) === 0;

    for (const state of scoreBySystem.values()) {
      state.score *= (1 - decayRate);

      // Exploration bonus: periodically nudge starving systems toward neutral
      // so they occasionally earn enough trust to act via negotiationEngine.
      if (applyExploration && state.score < EXPLORATION_THRESHOLD && state.samples > 16) {
        state.score = clamp(state.score + EXPLORATION_NUDGE, -1, 1);
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

  function reset() {
    scoreBySystem.clear();
    decayCycleCount = 0;
  }

  return { registerOutcome, getWeight, decayAll, getSnapshot, reset };
})();
crossLayerRegistry.register('adaptiveTrustScores', adaptiveTrustScores, ['all']);
