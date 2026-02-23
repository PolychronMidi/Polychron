AdaptiveTrustScores = (() => {
  const V = Validator.create('adaptiveTrustScores');
  /** @type {Map<string, { score: number, samples: number, lastMs: number }>} */
  const scoreBySystem = new Map();

  /** @param {string} systemName */
  function ensure(systemName) {
    V.assertNonEmptyString(systemName, 'systemName');
    if (!scoreBySystem.has(systemName)) {
      scoreBySystem.set(systemName, { score: 0, samples: 0, lastMs: 0 });
    }
    const state = scoreBySystem.get(systemName);
    if (!state) throw new Error('AdaptiveTrustScores: failed to initialize state for ' + systemName);
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
    state.score = clamp(state.score * 0.9 + p * 0.1, -1, 1);
    state.samples += 1;
    state.lastMs = beatStartTime * 1000;

    ExplainabilityBus.emit('trust-update', 'both', {
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
    for (const state of scoreBySystem.values()) {
      state.score *= (1 - decayRate);
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
  }

  return { registerOutcome, getWeight, decayAll, getSnapshot, reset };
})();
CrossLayerRegistry.register('AdaptiveTrustScores', AdaptiveTrustScores, ['all']);
