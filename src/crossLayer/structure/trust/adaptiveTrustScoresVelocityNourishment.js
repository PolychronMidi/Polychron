// src/crossLayer/structure/trust/adaptiveTrustScoresVelocityNourishment.js

moduleLifecycle.declare({
  name: 'adaptiveTrustScoresVelocityNourishment',
  subsystem: 'crossLayer',
  deps: [],
  lazyDeps: ['conductorSignalBridge', 'explainabilityBus'],
  provides: ['adaptiveTrustScoresVelocityNourishment'],
  init: () => {
  const _VELOCITY_EMA_ALPHA = 0.02;         // ~50-beat horizon
  const _STAGNATION_THRESHOLD = 0.001;      // velocity below this is "stagnant"
  const _DISENGAGE_THRESHOLD = 0.003;       // 3x threshold for hysteresis disengage
  const _DISENGAGE_BEATS = 50;              // beats above disengage threshold before stopping
  const _STAGNATION_BEATS_TRIGGER = 70;     // R33 E2: 100->70 faster recovery of stuck systems
  // Lower coherent trigger 100->70. With coherent at 50.7% in R15,
  const STAGNATION_BEATS_REGIME = { exploring: 50, evolving: 70, coherent: 70 };
  const _BASE_NOURISHMENT_STRENGTH = 0.15;  // max synthetic payoff scaling
  const _MIN_NOURISHMENT_STRENGTH = 0.05;   // floor after decay
  const _NOURISHMENT_DECAY = 0.90;          // 10% decay per application
  const TRUST_CEILING = 0.75;

  /** @type {Map<string, { velocityEma: number, stagnantBeats: number, lastScore: number, disengageBeats: number, nourishmentCount: number, effectiveStrength: number }>} */
  const velocityState = new Map();

  /**
   * Run per-system velocity stagnation detection and synthetic nourishment injection.
   * Mutates state.score directly. Called from decayAll after per-system decay loop.
   * @param {Map<string, { score: number, samples: number, lastMs: number }>} scoreBySystem
   * @param {number} meanTrust
   * @param {{ trustAxisPressure: number, phaseLaneNeed: number }} context
   */
  function runVelocityNourishment(scoreBySystem, meanTrust, context) {
    const trustSharePressure = context.trustAxisPressure;
    const phaseLaneNeed = context.phaseLaneNeed;

    for (const [name, state] of scoreBySystem.entries()) {
      let vs = velocityState.get(name);
      if (!vs) {
        vs = { velocityEma: 0, stagnantBeats: 0, lastScore: state.score, disengageBeats: 0, nourishmentCount: 0, effectiveStrength: _BASE_NOURISHMENT_STRENGTH };
        velocityState.set(name, vs);
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
          // Partial strength reset: a system that escaped stagnation and stayed active
          if (vs.effectiveStrength < _BASE_NOURISHMENT_STRENGTH * 0.7) {
            vs.effectiveStrength = m.min(_BASE_NOURISHMENT_STRENGTH, vs.effectiveStrength / _NOURISHMENT_DECAY);
          }
        }
      } else {
        // In between thresholds: hold current state (hysteresis band)
        vs.disengageBeats = 0;
      }

      // R95 E4: Regime-responsive stagnation trigger
      const stagnRegime = conductorSignalBridge.getSignals().regime || 'evolving';
      const stagnTrigger = STAGNATION_BEATS_REGIME[stagnRegime] !== undefined ? STAGNATION_BEATS_REGIME[stagnRegime] : _STAGNATION_BEATS_TRIGGER;
      const depthPenalty = clamp(state.score / m.max(meanTrust, 0.01), 0.5, 1.0);
      const stagnTriggerScaled = m.floor(stagnTrigger * depthPenalty);
      if (vs.stagnantBeats >= stagnTriggerScaled && state.samples > 32) {
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
  }

  function resetVelocityState() {
    velocityState.clear();
  }

  return { runVelocityNourishment, resetVelocityState };
  },
});
