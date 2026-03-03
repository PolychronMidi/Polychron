// @ts-check

/**
 * Regime-Reactive Damping (E4)
 *
 * Reads the current regime from systemDynamicsProfiler and adjusts
 * density / tension / flicker biases so the signal pipeline responds
 * appropriately to each dynamical phase.
 *
 * Stagnant  - inject variety (density up, flicker up)
 * Fragmented - dampen extremes (density - 1, tension - 1)
 * Oscillating - counter-cycle (flicker down)
 * Exploring - slight tension lift
 * Coherent / Evolving - neutral (1.0)
 */

regimeReactiveDamping = (() => {

  // --- Base bias per regime (direction only; magnitude scales with curvature) ---
  const REGIME_DENSITY_DIR = {
    stagnant: 1,     // boost
    fragmented: 0,   // neutral
    oscillating: 0,  // neutral
    exploring: 0,    // neutral
    coherent: 0,     // neutral
    evolving: 0,     // neutral
    drifting: -1,    // suppress
  };

  const REGIME_TENSION_DIR = {
    stagnant: 0,
    fragmented: 0,
    oscillating: 0,
    exploring: 1,
    coherent: 0,
    evolving: 0,
    drifting: 1,
  };

  const REGIME_FLICKER_DIR = {
    stagnant: 1,     // boost
    fragmented: -1,  // dampen
    oscillating: 0,  // neutral (was -1 - dampening flicker while density is neutral
                     //   created mechanical anti-correlation r=-0.7 via shared causal path)
    exploring: 1,    // boost variation - inject independent flicker to reduce density-flicker coupling
    coherent: 0,     // neutral - suppression (was -1) compressed flicker range and inflated coupling via near-zero variance
    evolving: 0,
    drifting: 0,
  };

  // Max bias magnitude per signal (how far from 1.0 we can go)
  const MAX_DENSITY = 0.12;  // - range 0.88-1.12
  const MAX_TENSION = 0.06;  // - range 0.94-1.06
  const MAX_FLICKER = 0.15;  // - range 0.85-1.15

  // Curvature scaling: bias = 1 + dir * max * curvatureGain
  // At curvature 0 - bias = 1.0 (neutral). At curvature 1.0 - full magnitude.
  const CURVATURE_CEILING = 1.0;

  // EMA smoothing on bias outputs - prevents discontinuous jumps on regime
  // transitions that feed back as self-induced oscillation via the profiler.
  const BIAS_SMOOTHING = 0.20;

  // --- Velocity floor: detect phase-space stasis and inject directional drift ---
  // When velocity stays below threshold for LOW_VEL_BEATS, nudge the least-active
  // axis to restart trajectory movement. This addresses the "near-zero velocity
  // despite evolving regime" problem - the system equilibrates too fast.
  const LOW_VEL_THRESHOLD = 0.015;
  const LOW_VEL_BEATS     = 8;
  const DRIFT_MAGNITUDE   = 0.09;
  const DRIFT_DECAY       = 0.93; // drift decays each beat, replaced when velocity recovers
  let lowVelStreak = 0;
  let _driftD = 0;
  let _driftT = 0;
  let _driftF = 0;
  let _injectionCount = 0; // persistent counter for sign alternation (survives streak resets)

  // -- #2: Regime Distribution Equilibrator (Hypermeta) --
  // Tracks regime occurrences in a rolling window and auto-modulates bias
  // to steer the distribution toward target budget. When a regime dominates
  // (e.g. exploring 71%), the equilibrator counteracts the biases that
  // encourage it, eliminating manual regime-bias re-tuning between rounds.
  const _REGIME_RING_SIZE = 64;
  /** @type {string[]} */
  const _regimeRing = [];
  const _REGIME_BUDGET = {
    exploring: 0.35,
    coherent: 0.35,
    evolving: 0.20,
    stagnant: 0.03,
    fragmented: 0.03,
    oscillating: 0.02,
    drifting: 0.02,
  };
  const _EQUILIB_STRENGTH = 0.25;
  let _eqCorrD = 0;
  let _eqCorrT = 0;
  let _eqCorrF = 0;

  // -- #7 (R7): Tension Pin Relief Valve --
  // When tension bias pins at its ceiling for >10 consecutive beats,
  // temporarily relax the ceiling by 5% to prevent sustained saturation.
  // Resets after 5 beats of non-pinned output.
  let _tensionPinStreak = 0;
  let _tensionUnpinStreak = 0;
  let _tensionCeilingRelax = 0;  // additive relaxation on MAX_TENSION
  const _PIN_STREAK_TRIGGER = 10;
  const _UNPIN_RESET_BEATS = 5;
  const _PIN_RELAX_STEP = 0.05;  // 5% of MAX_TENSION per trigger

  let currentRegime = 'evolving';
  let curvatureGain = 0;
  let _smoothedDensity = 1.0;
  let _smoothedTension = 1.0;
  let _smoothedFlicker = 1.0;

  function refresh() {
    const snap = systemDynamicsProfiler.getSnapshot();
    currentRegime = snap ? snap.regime : 'evolving';
    const rawCurv = snap ? (snap.curvature || 0) : 0;
    curvatureGain = clamp(rawCurv / CURVATURE_CEILING, 0, 1);

    // -- #2: Regime distribution equilibrator --
    _regimeRing.push(currentRegime);
    if (_regimeRing.length > _REGIME_RING_SIZE) _regimeRing.shift();
    if (_regimeRing.length >= 16) {
      /** @type {Record<string, number>} */
      const _shares = {};
      for (let ri = 0; ri < _regimeRing.length; ri++) {
        _shares[_regimeRing[ri]] = (_shares[_regimeRing[ri]] || 0) + 1;
      }
      for (const rk in _shares) _shares[rk] /= _regimeRing.length;

      const expShare = _shares.exploring || 0;
      const expExcess = m.max(0, expShare - _REGIME_BUDGET.exploring);
      const cohDeficit = m.max(0, _REGIME_BUDGET.coherent - (_shares.coherent || 0));
      const evoDeficit = m.max(0, _REGIME_BUDGET.evolving - (_shares.evolving || 0));

      // R7 Evo 1: Squared penalty when exploring exceeds 60% - creates
      // a soft wall preventing runaway exploring domination.
      const expPenalty = expShare > 0.60 ? 1.0 + (expShare - 0.60) * (expShare - 0.60) : 1.0;

      // Exploring over-budget: suppress variety-promoting biases
      _eqCorrD = -expExcess * _EQUILIB_STRENGTH * 0.5 * expPenalty;
      _eqCorrF = -expExcess * _EQUILIB_STRENGTH * expPenalty;
      // Coherent/evolving deficit: boost tension (encourages coupling/convergence)
      _eqCorrT = (cohDeficit + evoDeficit * 0.5) * _EQUILIB_STRENGTH;

      // R7 Evo 9: Feed equilibrator corrections to meta-controller watchdog
      safePreBoot.call(() => {
        if (_eqCorrD !== 0) conductorMetaWatchdog.recordCorrection('density', 'equilibrator', _eqCorrD);
        if (_eqCorrT !== 0) conductorMetaWatchdog.recordCorrection('tension', 'equilibrator', _eqCorrT);
        if (_eqCorrF !== 0) conductorMetaWatchdog.recordCorrection('flicker', 'equilibrator', _eqCorrF);
      });
    }

    // --- Velocity floor logic ---
    const velocity = snap ? (snap.velocity || 0) : 0;
    if (velocity < LOW_VEL_THRESHOLD) {
      lowVelStreak++;
    } else {
      lowVelStreak = 0;
      _driftD *= DRIFT_DECAY;
      _driftT *= DRIFT_DECAY;
      _driftF *= DRIFT_DECAY;
    }

    if (lowVelStreak >= LOW_VEL_BEATS && snap && snap.couplingMatrix) {
      // Find the axis with weakest absolute correlation to others -
      // perturbing it has the least chance of cascading through coupling.
      const cm = snap.couplingMatrix;
      const dCoup = m.abs(cm['density-tension'] || 0) + m.abs(cm['density-flicker'] || 0);
      const tCoup = m.abs(cm['density-tension'] || 0) + m.abs(cm['tension-flicker'] || 0);
      const fCoup = m.abs(cm['density-flicker'] || 0) + m.abs(cm['tension-flicker'] || 0);

      // Directional: alternate sign using persistent counter to prevent
      // monotonic drift. _injectionCount survives streak resets and section
      // resets, ensuring true alternation across the full composition.
      _injectionCount++;
      const sign = (_injectionCount % 2 === 0) ? 1 : -1;

      if (dCoup <= tCoup && dCoup <= fCoup) {
        _driftD = sign * DRIFT_MAGNITUDE;
      } else if (tCoup <= fCoup) {
        _driftT = sign * DRIFT_MAGNITUDE;
      } else {
        _driftF = sign * DRIFT_MAGNITUDE;
      }
      // Reset streak so drift is injected once per LOW_VEL_BEATS window
      lowVelStreak = 0;
    }

    // Compute raw bias values with equilibrator corrections (#2)
    const rawD = 1.0 + (REGIME_DENSITY_DIR[currentRegime] || 0) * MAX_DENSITY * curvatureGain + _driftD + _eqCorrD;
    // #7 (R7): Tension pin relief valve - track pinning and relax ceiling
    const effectiveMaxTension = MAX_TENSION + _tensionCeilingRelax;
    const rawT = 1.0 + (REGIME_TENSION_DIR[currentRegime] || 0) * effectiveMaxTension * curvatureGain + _driftT + _eqCorrT;
    const rawF = 1.0 + (REGIME_FLICKER_DIR[currentRegime] || 0) * MAX_FLICKER * curvatureGain + _driftF + _eqCorrF;
    _smoothedDensity = _smoothedDensity * (1 - BIAS_SMOOTHING) + rawD * BIAS_SMOOTHING;
    _smoothedTension = _smoothedTension * (1 - BIAS_SMOOTHING) + rawT * BIAS_SMOOTHING;
    _smoothedFlicker = _smoothedFlicker * (1 - BIAS_SMOOTHING) + rawF * BIAS_SMOOTHING;

    // #7 (R7): Update tension pin relief valve state
    const tensionAtPin = m.abs(_smoothedTension - (1.0 + effectiveMaxTension)) < 0.005
                      || m.abs(_smoothedTension - (1.0 - effectiveMaxTension)) < 0.005;
    if (tensionAtPin) {
      _tensionPinStreak++;
      _tensionUnpinStreak = 0;
      if (_tensionPinStreak > _PIN_STREAK_TRIGGER) {
        _tensionCeilingRelax = clamp(_tensionCeilingRelax + MAX_TENSION * _PIN_RELAX_STEP, 0, MAX_TENSION * 0.30);
        _tensionPinStreak = 0; // reset so next trigger needs another streak
        safePreBoot.call(() => explainabilityBus.emit('tension-pin-relief', 'both', {
          newCeiling: MAX_TENSION + _tensionCeilingRelax,
          baseCeiling: MAX_TENSION
        }));
      }
    } else {
      _tensionUnpinStreak++;
      _tensionPinStreak = 0;
      if (_tensionUnpinStreak > _UNPIN_RESET_BEATS) {
        _tensionCeilingRelax = 0;
        _tensionUnpinStreak = 0;
      }
    }

    // Decay drift contribution
    _driftD *= DRIFT_DECAY;
    _driftT *= DRIFT_DECAY;
    _driftF *= DRIFT_DECAY;
  }

  function densityBias() {
    return _smoothedDensity;
  }

  function tensionBias() {
    return _smoothedTension;
  }

  function flickerMod() {
    return _smoothedFlicker;
  }

  function reset() {
    currentRegime = 'evolving';
    curvatureGain = 0;
    _smoothedDensity = 1.0;
    _smoothedTension = 1.0;
    _smoothedFlicker = 1.0;
    // Drift state intentionally NOT reset on section boundaries.
    // The profiler (scope 'all') retains trajectory history across sections,
    // so drift must persist to maintain momentum. lowVelStreak resets to
    // allow re-detection in the new section, but accumulated drift and
    // injection count carry forward.
    lowVelStreak = 0;
    // #2: Reset equilibrator ring buffer on section boundary
    _regimeRing.length = 0;
    _eqCorrD = 0;
    _eqCorrT = 0;
    _eqCorrF = 0;
    // #7: Reset relief valve
    _tensionPinStreak = 0;
    _tensionUnpinStreak = 0;
    _tensionCeilingRelax = 0;
  }

  // --- Self-registration ---
  conductorIntelligence.registerDensityBias('regimeReactiveDamping', densityBias, 0.88, 1.12);
  // R11 Evo 3: Widen tension bias upper bound from 1.06 to 1.15 -- raw values
  // routinely reached 1.11 via drift+equilibrator, clipping against old ceiling.
  conductorIntelligence.registerTensionBias('regimeReactiveDamping', tensionBias, 0.94, 1.15);
  conductorIntelligence.registerFlickerModifier('regimeReactiveDamping', flickerMod, 0.85, 1.15);
  conductorIntelligence.registerRecorder('regimeReactiveDamping', refresh);
  conductorIntelligence.registerModule('regimeReactiveDamping', { reset }, ['section']);

  feedbackRegistry.registerLoop(
    'regimeReactiveDamping',
    'regime',
    'density',
    () => m.abs(_smoothedDensity - 1.0) / MAX_DENSITY,
    () => m.sign(_smoothedDensity - 1.0)
  );

  return { densityBias, tensionBias, flickerMod, reset };
})();
