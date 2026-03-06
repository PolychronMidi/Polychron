// regimeClassifier.js - Regime classification with hysteresis for system dynamics.
// Classifies the system's operating mode (stagnant, oscillating, coherent, exploring,
// drifting, fragmented, evolving) from trajectory metrics. Applies hysteresis to prevent
// single-beat noise from flip-flopping regime-reactive damping.
//
// Extracted from systemDynamicsProfiler.js for single-responsibility.

regimeClassifier = (() => {
  const V = validator.create('regimeClassifier');

  // R37 E1: Majority-window hysteresis replaces consecutive-streak.
  // R36 proved REGIME_HOLD=3 still insufficient: 87 raw coherent beats
  // (10.6%) were too scattered for 3 consecutive (P ~ 0.12% per window).
  // Majority-window: if 3 of last 5 raw beats classify as the same
  // non-current regime, transition. P(>=3 of 5 | p=0.106) ~ 4.7% per
  // window, so over 823 beats we expect ~39 qualifying windows.
  const _REGIME_WINDOW = 5;
  const _REGIME_MAJORITY = 3;

  // Profile-adaptive oscillating curvature threshold
  const OSCILLATING_CURVATURE_DEFAULT = 0.55;

  let lastRegime = 'evolving';
  // R37 E1: Rolling window of recent raw regimes for majority check
  let _rawRegimeWindow = [];
  let exploringBeats = 0; // duration escalator: consecutive exploring beats
  let coherentBeats = 0;  // saturation guard: consecutive coherent beats
  let oscillatingCurvatureThreshold = OSCILLATING_CURVATURE_DEFAULT;
  let coherentThresholdScale = 0.65; // R36 E6: lowered from 0.75. R35 self-balancer pushed scale to 0.55 floor within ~33 nudges. Starting at 0.65 reaches floor sooner, giving coherent more beats at the lowest threshold.
  // R22 E4 / R24 E1: Evolving regime minimum dwell time. Prevents the
  // system from passing through evolving too quickly. R22 set 12 beats
  // which catastrophically disrupted bistable coherent feedback (0% coherent
  // in R23). R24 reduces to 4 (explosive) / 6 (atmospheric) as minimal
  // guard that still allows coherent entry within the feedback window.
  let _evolvingBeats = 0;
  let _evolvingMinDwell = 4;  // default; profile-adaptive via setter
  const _evolvingMaxDwell = 150; // R42 E4: Hard override max limit
  const _coherentMaxDwell = 120; // R43 E4: Hard coherent max dwell override
  let _forcedRegime = '';
  let _forcedRegimeBeatsRemaining = 0;
  let _forcedBreakCount = 0;
  let _lastForcedReason = '';
  let _runMaxCoherentBeats = 0;
  let _runCoherentBeats = 0;
  let _runBeatCount = 0;
  let _runCoherentShare = 0;
  let _runLastResolvedRegime = 'evolving';
  let _forcedOverrideActive = false;
  let _forcedOverrideBeats = 0;
  let _lastForcedTriggerStreak = 0;
  let _lastForcedTriggerBeat = 0;
  const _runResolvedRegimeCounts = {};

  // R26 E2: Persistent proximity bonus across regime transitions.
  // During exploring, bonus accumulates at 0.001/beat. Without persistence,
  // bonus was lost on evolving->exploring transition since the old formula
  // only computed from _evolvingBeats (which resets on regime change).
  let _evolvingProximityBonus = 0;

  // R28 E5: Coherent momentum persistence. When coherent is lost, provide
  // a linearly-decaying threshold bonus to prevent premature exit during
  // brief coupling dips. Reduced from 15 to 8 beats -- regime self-balancing
  // now handles macro-level coherent targeting via coherentThresholdScale.
  const _COHERENT_MOMENTUM_WINDOW = 8;
  let _coherentMomentumBeats = 0;

  // R29/R30: Self-correcting regime targeting. Auto-adjusts coherentThresholdScale
  // based on rolling coherent share. Replaces ALL manual per-profile scale tuning.
  // Target range: 15-35% coherent. Nudge rate 0.004/beat, bounded [0.70, 1.20].
  // R30: Widened range from [0.80,1.15] -- R29 saturated at 0.80 floor in 40 beats.
  // R35 E1: Tripled nudge rate (0.002->0.006) and lowered floor (0.70->0.55).
  // R34 showed scale dropped 0.90->0.792 in 282 beats (0.004/beat) but
  // gapAvg was still +0.15. Need 0.006/beat to close gap within ~100 beats.
  // Floor 0.55 ensures the self-balancer can reduce threshold by 45%.
  const _REGIME_TARGET_COHERENT_LO = 0.15;
  const _REGIME_TARGET_COHERENT_HI = 0.35;
  const _REGIME_SCALE_NUDGE = 0.006;
  const _REGIME_SCALE_MIN = 0.55;
  const _REGIME_SCALE_MAX = 1.20;

  // R25 E6: Cached classify() inputs for transition diagnostics in resolve().
  // R34 E6: Extended with velocity, velThreshold for transition readiness diagnostic.
  let _lastClassifyInputs = { couplingStrength: 0, coherentThreshold: 0, evolvingProximityBonus: 0, velocity: 0, velThreshold: 0.008 };

  // R40 E5: Evolving-to-Exploring Escape Hatch streak tracker
  let _highDimVelStreak = 0;

  // R36 E4: Raw regime diagnostic. Tallies how many beats each raw
  // classification appears (before hysteresis). Comparing rawRegimeCounts
  // vs resolved regimeCounts reveals hysteresis deadlock: if rawCoherent
  // is high but resolvedCoherent is 0, the hysteresis is still
  // breaking the chain.
  const _rawRegimeCounts = {};
  const _runRawRegimeCounts = {};

  // R37 E6: Track max consecutive streak per raw regime.
  // Reveals whether raw coherent beats cluster (streak=5+) or scatter (streak=1-2).
  const _rawRegimeMaxStreak = {};
  let _rawStreakRegime = '';
  let _rawStreakCount = 0;

  // R17 structural fix: Self-calibrating regime saturation.
  // Tracks rolling coherent share and derives penalty dynamically instead of
  // using static cap/rate constants. When coherent share > 60%, penalty
  // escalates proportionally. Eliminates manual cap tuning between rounds.
  // R19 E3: Profile-adaptive convergence. Fixed alpha=0.01 (~100-beat horizon)
  // converged too slowly for atmospheric profile (326 consecutive coherent
  // beats). Adaptive alpha: starts at 0.05 (~20 beats), decays exponentially
  // to floor by ~160 beats. Gives 5x faster initial convergence while
  // maintaining stable long-horizon behavior.
  // R20 E4: Raised floor from 0.01 to 0.025. At 0.01 (~100-beat), 426
  // consecutive coherent beats in R20 atmospheric created a regime lock
  // (69.7% coherent, maxConsecutive=426). floor 0.025 (~40 beats) ensures
  // the coherent share EMA tracks recent regime distribution accurately
  // enough that the penalty function can actually fire escape transitions.
  // R21 E3: Made profile-adaptive via setter. Explosive=0.04 (~25-beat),
  // atmospheric=0.02 (~50-beat), default=0.025 (~40-beat). Explosive's
  // shorter sections (~138 beats) need faster convergence to prevent
  // the 74.2% coherent lock observed in R21.
  let _coherentShareAlphaMin = 0.025;  // steady-state: ~40-beat horizon (default)
  const _COHERENT_SHARE_ALPHA_INIT = 0.05;  // initial: ~20-beat horizon
  const _COHERENT_SHARE_ALPHA_DECAY = 80;   // exponential decay constant
  let _coherentShareEma = 0.25;             // R30: initial 0.25 (was 0.50) -- avoids immediate downward scale pressure from false high-coherent assumption

  /**
   * Set the oscillating curvature threshold (profile-adaptive).
   * @param {number} threshold
   */
  function setOscillatingThreshold(threshold) {
    oscillatingCurvatureThreshold = V.requireFinite(threshold, 'threshold');
  }

  /**
   * Set profile-adaptive coherent entry threshold scale.
   * Values < 1.0 make coherent regime easier to enter.
   * @param {number} scale
   */
  function setCoherentThresholdScale(scale) {
    coherentThresholdScale = V.requireFinite(scale, 'coherentThresholdScale');
  }

  /**
   * R21 E3: Set profile-adaptive coherent share alpha floor.
   * Higher values = faster EMA convergence = quicker saturation penalty.
   * explosive: 0.04 (~25-beat horizon), atmospheric: 0.02 (~50-beat),
   * default: 0.025 (~40-beat).
   * @param {number} alphaMin
   */
  function setCoherentShareAlphaMin(alphaMin) {
    _coherentShareAlphaMin = V.requireFinite(alphaMin, 'alphaMin');
  }

  /**
   * R22 E4 / R24 E1: Set profile-adaptive evolving minimum dwell time.
   * Prevents premature evolving->coherent transitions.
   * explosive: 4, atmospheric: 6, default: 4.
   * @param {number} minDwell
   */
  function setEvolvingMinDwell(minDwell) {
    _evolvingMinDwell = V.requireFinite(minDwell, 'minDwell');
  }

  /** @returns {number} */
  function getOscillatingThreshold() { return oscillatingCurvatureThreshold; }

  /** @returns {number} */
  function getExploringBeats() { return exploringBeats; }

  /** @returns {string} */
  function getLastRegime() { return lastRegime; }

  /**
   * Classify the current operating regime based on velocity and curvature patterns.
   * @param {number} avgVelocity
   * @param {number} avgCurvature
   * @param {number} effectiveDim
   * @param {number} couplingStrength
   * @returns {string}
   */
  function classify(avgVelocity, avgCurvature, effectiveDim, couplingStrength) {
    // Thresholds calibrated for adaptive STATE_SMOOTHING targeting effective
    // responsiveness ~0.175 (profileSmoothing * stateSmoothing). Validated
    // against explosive (0.5 * 0.35) and default (0.8 * 0.22) profiles.
    // Coupling strength and effectiveDim are scoped to compositional
    // dimensions only (4D, 6 pairs).

    // Stagnant: barely moving through state space
    if (avgVelocity < 0.004) return 'stagnant';
    // Oscillating: high curvature (frequent reversals) with moderate velocity.
    // Threshold is profile-adaptive - explosive tolerates higher curvature.
    if (avgCurvature > oscillatingCurvatureThreshold && avgVelocity < 0.04) return 'oscillating';
    // Coherent: strong coupling + moving (dimensions move together).
    // Checked BEFORE exploring so that coupled high-velocity systems are
    // recognized as coherent rather than stuck in permanent exploring.
    // Coherent momentum: if the system was recently coherent, lower the
    // threshold by 0.05 to make coherence "sticky" (hysteresis bonus).
    // Exploring-duration escalator: the longer the system stays in exploring,
    // the easier it becomes to escape into coherent (self-healing). Every 50
    // exploring beats lowers the threshold by 0.02, down to 0.18 minimum.
    // R7 Evo 5: Coherent entry threshold lowered by 15% to make
    // coherent regime more accessible. Coherent floor: when system has
    // been in exploring for extended periods, further lower the threshold
    // by up to 0.05 based on exploring duration (adds to duration bonus).
    const coherentFloorBonus = exploringBeats > 100 ? clamp((exploringBeats - 100) * 0.0005, 0, 0.05) : 0;
    const durationBonus = lastRegime === 'exploring' ? clamp(m.floor(exploringBeats / 50) * 0.02, 0, 0.12) : 0;

    // R28 E5: Coherent momentum. When system was recently coherent (within
    // 15 beats), provide a linearly-decaying threshold bonus. This makes
    // regime exit bidirectionally asymmetric: hard to enter but also hard
    // to leave. The bonus decays from 0.05 to 0 over 15 beats.
    const momentumBonus = _coherentMomentumBeats > 0
      ? 0.05 * (_coherentMomentumBeats / _COHERENT_MOMENTUM_WINDOW)
      : 0;
    // Decrement momentum counter each beat (active even during non-coherent)
    if (_coherentMomentumBeats > 0) _coherentMomentumBeats--;

    // R14 Evo 2: Exploring Convergence Acceleration
    // Force transition to evolving or coherent faster if stuck exploring for > 32 beats
    let convergenceBonus = 0;
    if (lastRegime === 'exploring' && exploringBeats > 32) {
      convergenceBonus = clamp((exploringBeats - 32) * 0.005, 0, 0.15);
    }

    // R17 structural fix: Self-calibrating coherent saturation.
    // Penalty derived from rolling coherent-share EMA instead of static cap.
    // When coherent share > 60%, penalty cap scales up proportionally (0.08 base
    // + up to 0.20 extra). This auto-adjusts across profiles without manual tuning.
    // R19 E3: Adaptive alpha for faster initial convergence.
    // alpha = max(0.01, 0.05 * exp(-coherentBeats / 80))
    // At beat 0: alpha=0.05 (~20 horizon). Beat 80: alpha~0.018. Beat 160: alpha->0.01.
    const _adaptiveAlpha = m.max(_coherentShareAlphaMin,
      _COHERENT_SHARE_ALPHA_INIT * m.exp(-coherentBeats / _COHERENT_SHARE_ALPHA_DECAY));
    _coherentShareEma = _coherentShareEma * (1 - _adaptiveAlpha) + (lastRegime === 'coherent' ? 1 : 0) * _adaptiveAlpha;

    // R29: Self-correcting regime balance. When coherent share exceeds target
    // range, tighten entry (raise scale). When below, ease entry (lower scale).
    // This permanently replaces manual per-profile coherentThresholdScale tuning.
    if (_coherentShareEma > _REGIME_TARGET_COHERENT_HI) {
      coherentThresholdScale = m.min(_REGIME_SCALE_MAX, coherentThresholdScale + _REGIME_SCALE_NUDGE);
    } else if (_coherentShareEma < _REGIME_TARGET_COHERENT_LO) {
      coherentThresholdScale = m.max(_REGIME_SCALE_MIN, coherentThresholdScale - _REGIME_SCALE_NUDGE);
    }

    const _dynamicPenaltyCap = 0.08 + clamp((_coherentShareEma - 0.60) * 1.0, 0, 0.20);
    const _dynamicPenaltyRate = 0.003 + clamp((_coherentShareEma - 0.50) * 0.004, 0, 0.004);
    let coherentDurationPenalty = 0;
    if (lastRegime === 'coherent' && coherentBeats > 35) {
      coherentDurationPenalty = clamp((coherentBeats - 35) * _dynamicPenaltyRate, 0, _dynamicPenaltyCap);
      // R43 E1 / R44 E2: Uncapped Saturation Acceleration (self-correcting scale)
      if (coherentBeats > 100) {
        const dynamicSaturationScale = 0.02 + m.max(0, (_coherentShareEma - _REGIME_TARGET_COHERENT_HI) * 0.05);
        coherentDurationPenalty += (coherentBeats - 100) * dynamicSaturationScale;
      }
    }

    const baseCoherentThreshold = (lastRegime === 'coherent' ? 0.25 : 0.30) * 0.85 * coherentThresholdScale; // R7 Evo 5: 15% reduction, profile-scaled
    // R24 E1: Evolving proximity seeding. When system has been in evolving
    // past the minimum dwell, progressively lower the coherent threshold.
    // Breaks bistability where coupling (0.214 in R23) sits just below
    // threshold (~0.255) indefinitely because coherent relaxation never
    // activates. Max bonus 0.05 (~20% of base threshold) after 50 beats.
    // R25 E1: Rate doubled 0.001->0.002, cap raised 0.05->0.07.
    // R24 missed coherent by 0.003 with 44 beats at 0.001/beat (bonus=0.044).
    // At 0.002/beat, 0.07 cap reached at 35+dwell beats instead of 54.
    // R26 E2: Extend proximity seeding to exploring regime at half rate.
    // R25 spent 302 exploring beats (122-424) with zero seeding. System
    // had to reach coherent purely through natural dynamics + partial
    // relaxation. Adding 0.001/beat during exploring provides continuous
    // threshold assistance, ensuring cap (0.07) is reached and maintained.
    let evolvingProximityBonus = 0;
    if (lastRegime === 'evolving' && _evolvingBeats > _evolvingMinDwell) {
      evolvingProximityBonus = clamp((_evolvingBeats - _evolvingMinDwell) * 0.002, 0, 0.07);
    } else if (lastRegime === 'exploring') {
      evolvingProximityBonus = clamp(_evolvingProximityBonus + 0.001, 0, 0.07);
    }
    _evolvingProximityBonus = evolvingProximityBonus;
    const coherentThreshold = baseCoherentThreshold - durationBonus - coherentFloorBonus - convergenceBonus - evolvingProximityBonus - momentumBonus + coherentDurationPenalty;
    // R27 E5: Relax velocity threshold from 0.008 to 0.005 after 100 exploring
    // beats. In R26, coherent entry was at beat 376/439 (85.6% through) despite
    // the coupling threshold being deeply negative by beat ~200. The bottleneck
    // is the velocity condition: transient velocity dips below 0.008 prevent
    // coherent entry even when coupling strength vastly exceeds threshold.
    // 0.005-0.008 still represents meaningful state-space movement; 5-beat
    // hysteresis guards against premature entry from fleeting velocity dips.
    const _velThreshold = exploringBeats > 100 ? 0.005 : 0.008;
    // R25 E6: Cache classify inputs for transition diagnostics in resolve()
    // R34 E6: Include velocity + velThreshold for transition readiness
    // R35 E5: Include effectiveDim for exploring-block diagnostic
    _lastClassifyInputs = { couplingStrength, coherentThreshold, evolvingProximityBonus, velocity: avgVelocity, velThreshold: _velThreshold, effectiveDim };

    // R40 E5: Evolving-to-Exploring Escape Hatch check
    if (effectiveDim > 2.8 && avgVelocity > 0.012) {
      _highDimVelStreak++;
    } else {
      _highDimVelStreak = 0;
    }

    // R43 E2: Re-elevated Escape Hatch Precedence with coherent guard
    if (_highDimVelStreak >= 10 && lastRegime !== 'coherent') {
      return 'exploring';
    }

    // R36 E2: effectiveDim gate on coherent entry.
    // R37 E2: Tightened from 4.0 to 3.5. R36 data: 87 raw coherent beats
    // vs 2 raw exploring. effectiveDim almost always > 4.0, swallowing all
    // potential exploring beats into coherent. At 3.5, more beats with
    // 3-4 effective dimensions redirect to exploring.
    // R41 E2: Relaxed back to 4.0 because high multi-dimensionality is healthy.
    if (couplingStrength > coherentThreshold && avgVelocity > _velThreshold && effectiveDim <= 4.0) return 'coherent';

    // Exploring: high velocity + multi-dimensional + weak coupling.
    // Gate widened (0.30 -> 0.40) so moderately-coupled systems can escape
    // exploring into coherent more easily.
    // R35 E2: Lowered velocity threshold from 0.02 to 0.015. R34 had 0%
    // exploring because velocity was consistently in the 0.008-0.02 dead
    // zone (too fast for evolving cutoff, too slow for exploring entry).
    // R36 E5: Adaptive relaxation. After 100+ consecutive evolving beats
    // without transition, relax from 0.015 to 0.010. In R35, 15 beats
    // were velocity-blocked at the 0.015 threshold. This recaptures them
    // during prolonged evolving locks.
    // R37 E3: Exploring coupling gate widened 0.40->0.50. In R36 coupling
    // averages ranged 0.19-0.44, so many beats with moderate coupling were
    // blocked. At 0.50, midrange-coupled high-dim beats can enter exploring.
    const _exploringVelThreshold = _evolvingBeats > 100 ? 0.010 : 0.012;
    // R43 E3: Exploring Dimension Relief
    const _exploringDimThreshold = couplingStrength < 0.50 ? 2.2 : 2.5;
    if (avgVelocity > _exploringVelThreshold && effectiveDim > _exploringDimThreshold && couplingStrength <= 0.50) return 'exploring';
    // Exploring -> evolving transition: sustained coupling increase while
    // exploring triggers evolving rather than jumping straight to coherent.
    // This creates richer regime lifecycle: exploring -> evolving -> coherent.
    if (lastRegime === 'exploring' && avgVelocity > 0.008 && couplingStrength > 0.10) return 'evolving';
    // Fragmented: weak coupling + multi-dimensional (dimensions independent + noisy)
    if (couplingStrength < 0.15 && effectiveDim > 2.5) return 'fragmented';
    // Drifting: moderate velocity, low curvature (slow one-directional change)
    if (avgCurvature < 0.2 && avgVelocity > 0.008) return 'drifting';
    return 'evolving';
  }

  /**
   * @param {string} regime
   * @param {string} reason
   * @param {number} beatsRemaining
   * @param {number} [triggerStreak]
   */
  function activateForcedRegime(regime, reason, beatsRemaining, triggerStreak) {
    _forcedRegime = regime;
    _forcedRegimeBeatsRemaining = beatsRemaining;
    _forcedBreakCount++;
    _lastForcedReason = reason;
    _lastForcedTriggerStreak = V.optionalFinite(triggerStreak, 0);
    _lastForcedTriggerBeat = _runBeatCount + 1;
    _rawRegimeWindow.length = 0;
    explainabilityBus.emit('REGIME_FORCED_TRANSITION', 'both', {
      from: lastRegime,
      to: regime,
      reason,
      coherentBeats,
      runCoherentBeats: _runCoherentBeats,
      runCoherentShare: Number(_runCoherentShare.toFixed(4)),
      exploringBeats,
      evolvingBeats: _evolvingBeats,
      triggerStreak: _lastForcedTriggerStreak,
      triggerBeat: _lastForcedTriggerBeat,
      forcedBeatsRemaining: beatsRemaining,
      thresholdScale: coherentThresholdScale
    });
  }

  /**
   * @param {string} resolvedRegime
   */
  function updateRunResolvedTelemetry(resolvedRegime) {
    _runBeatCount++;
    _runResolvedRegimeCounts[resolvedRegime] = (_runResolvedRegimeCounts[resolvedRegime] || 0) + 1;

    if (resolvedRegime === 'coherent') {
      _runCoherentBeats = _runLastResolvedRegime === 'coherent' ? _runCoherentBeats + 1 : 1;
      _runMaxCoherentBeats = m.max(_runMaxCoherentBeats, _runCoherentBeats);
    } else {
      _runCoherentBeats = 0;
    }

    _runLastResolvedRegime = resolvedRegime;
    _runCoherentShare = _runBeatCount > 0
      ? (_runResolvedRegimeCounts.coherent || 0) / _runBeatCount
      : 0;
  }

  /**
   * Apply hysteresis to regime transitions.
   * R37 E1: Majority-window replaces consecutive-streak. Transitions when
   * >= _REGIME_MAJORITY of last _REGIME_WINDOW raw beats match a non-current regime.
   * @param {string} rawRegime - instantaneous classification from classify()
   * @returns {string} - stable regime with hysteresis
   */
  function resolve(rawRegime) {
    // R36 E4: Tally raw regime classifications before hysteresis
    _rawRegimeCounts[rawRegime] = (_rawRegimeCounts[rawRegime] || 0) + 1;
    _runRawRegimeCounts[rawRegime] = (_runRawRegimeCounts[rawRegime] || 0) + 1;

    // R37 E6: Track max consecutive streak per raw regime
    if (rawRegime === _rawStreakRegime) {
      _rawStreakCount++;
    } else {
      _rawStreakRegime = rawRegime;
      _rawStreakCount = 1;
    }
    _rawRegimeMaxStreak[rawRegime] = m.max(_rawRegimeMaxStreak[rawRegime] || 0, _rawStreakCount);

    // R44 E6: Self-correcting Hysteresis Smoothing Relaxation
    // Drop the window dynamically to speed up entry into new domains if locked in exploring.
    let effectiveWindow = _REGIME_WINDOW;
    if (lastRegime === 'exploring') {
      effectiveWindow = m.max(3, _REGIME_WINDOW - m.floor(exploringBeats / 40));
    }

    // R37 E1: Maintain rolling window
    _rawRegimeWindow.push(rawRegime);
    while (_rawRegimeWindow.length > effectiveWindow) _rawRegimeWindow.shift();

    // R44 E4: Exploring Max Dwell Limit
    const _exploringMaxDwell = 180;
    if (_forcedRegimeBeatsRemaining <= 0 && lastRegime === 'exploring' && exploringBeats >= _exploringMaxDwell) {
      activateForcedRegime('evolving', 'exploring-max-dwell', 3);
    }

    let resolvedRegime = lastRegime;
    _forcedOverrideActive = false;

    if (_forcedRegimeBeatsRemaining > 0) {
      resolvedRegime = _forcedRegime;
      _forcedOverrideActive = true;
      _forcedOverrideBeats++;
      _forcedRegimeBeatsRemaining--;
      _rawRegimeWindow.length = 0;
      if (_forcedRegimeBeatsRemaining === 0) {
        _forcedRegime = '';
      }
    } else {

      // R37 E1: Check if rawRegime has majority in rolling window
      if (rawRegime !== lastRegime && _rawRegimeWindow.length >= (_REGIME_MAJORITY - 1)) {
        let _windowHits = 0;
        for (let i = 0; i < _rawRegimeWindow.length; i++) {
          if (_rawRegimeWindow[i] === rawRegime) _windowHits++;
        }

        // R40 E1: Exploring Majority-Window Hysteresis (relaxed constraint to capture valid exploring blocks)
        const requiredHits = rawRegime === 'exploring' ? 2 : _REGIME_MAJORITY;

        if (_windowHits >= requiredHits) {
          // R22 E4: Evolving minimum dwell -- suppress evolving->coherent until
          // at least _evolvingMinDwell beats have passed in evolving.
          let allowTransition = true;

          // R42 E4: Hard max dwell timeout bypass
          if (lastRegime === 'evolving' && _evolvingBeats > _evolvingMaxDwell) {
            allowTransition = true; // explicitly force flip
          } else if (lastRegime === 'evolving' && rawRegime === 'coherent' && _evolvingBeats < _evolvingMinDwell) {
            allowTransition = false;
          }

          if (allowTransition) {
            // R25 E6: Regime transition diagnostic
            explainabilityBus.emit('REGIME_TRANSITION', 'both', {
              from: lastRegime, to: rawRegime,
              coupling: _lastClassifyInputs.couplingStrength,
              threshold: _lastClassifyInputs.coherentThreshold,
              proximityBonus: _lastClassifyInputs.evolvingProximityBonus,
              gap: _lastClassifyInputs.couplingStrength - _lastClassifyInputs.coherentThreshold,
              exploringBeats: lastRegime === 'exploring' ? exploringBeats + 1 : exploringBeats,
              evolvingBeats: lastRegime === 'evolving' ? _evolvingBeats + 1 : _evolvingBeats,
              windowHits: _windowHits
            });

            // R28 E5: Activate coherent momentum on coherent->non-coherent transition
            // R43 E6: Dynamic Momentum Expansion mapped to time stuck
            if (lastRegime === 'coherent') {
              _coherentMomentumBeats = m.max(_COHERENT_MOMENTUM_WINDOW, m.floor(coherentBeats * 0.25));
            }

            // R42 E6: Raw Hysteresis Flush
            _rawRegimeWindow.length = 0;
            resolvedRegime = rawRegime;
          }
        }
      }
    }

    if (_forcedRegimeBeatsRemaining <= 0 && resolvedRegime === 'coherent') {
      const projectedRunCoherentBeats = _runLastResolvedRegime === 'coherent' ? _runCoherentBeats + 1 : 1;
      if (projectedRunCoherentBeats > _coherentMaxDwell) {
        const coherentOvershoot = projectedRunCoherentBeats - _coherentMaxDwell;
        const forcedWindow = clamp(4 + m.floor(coherentOvershoot / 24) + m.floor(_coherentShareEma * 6), 4, 12);
        activateForcedRegime('exploring', 'coherent-max-dwell-run', forcedWindow, projectedRunCoherentBeats);
        resolvedRegime = 'exploring';
        _forcedOverrideActive = true;
        _forcedOverrideBeats++;
        _forcedRegimeBeatsRemaining = m.max(0, _forcedRegimeBeatsRemaining - 1);
        _rawRegimeWindow.length = 0;
        if (_forcedRegimeBeatsRemaining === 0) {
          _forcedRegime = '';
        }
      }
    }

    // R42 E1/E3: Hysteresis Increment Rectification / Parity
    // Increment the ACTUAL regime we resolved to this beat, unconditionally
    if (resolvedRegime === 'exploring') {
      exploringBeats++;
      coherentBeats = 0;
      _evolvingBeats = 0;
    } else if (resolvedRegime === 'coherent') {
      coherentBeats++;
      _runMaxCoherentBeats = m.max(_runMaxCoherentBeats, coherentBeats);
      exploringBeats = 0;
      _evolvingBeats = 0;
    } else if (resolvedRegime === 'evolving') {
      _evolvingBeats++;
      exploringBeats = 0;
      coherentBeats = 0;
    } else {
      exploringBeats = 0;
      coherentBeats = 0;
      _evolvingBeats = 0;
    }

    updateRunResolvedTelemetry(resolvedRegime);
    lastRegime = resolvedRegime;
    return resolvedRegime;
  }

  /**
   * Grade the trajectory health.
   * @param {string} regime
   * @returns {string}
   */
  function grade(regime) {
    if (regime === 'exploring' || regime === 'coherent' || regime === 'evolving') return 'healthy';
    if (regime === 'drifting' || regime === 'fragmented') return 'strained';
    if (regime === 'oscillating') return 'stressed';
    if (regime === 'stagnant') return 'critical';
    return 'healthy';
  }

  function reset() {
    const _prevCoherentShareEma = _coherentShareEma;
    const _prevCoherentBeats = coherentBeats;
    lastRegime = 'evolving';
    // R37 E1: Clear majority window on section reset
    _rawRegimeWindow = [];
    // R44 E5: Clear raw regime counts on section reset
    for (const key in _rawRegimeCounts) delete _rawRegimeCounts[key];
    exploringBeats = 0;
    _evolvingBeats = 0;
    _evolvingProximityBonus = 0;
    // R28 E5: Preserve momentum across section resets (damped to 50%)
    _coherentMomentumBeats = m.floor(_coherentMomentumBeats * 0.5);
    coherentBeats = m.floor(_prevCoherentBeats * 0.3);
    oscillatingCurvatureThreshold = OSCILLATING_CURVATURE_DEFAULT;
    // R30: Do NOT reset coherentThresholdScale on section reset. The self-
    // balancing loop's accumulated adjustment must persist across sections.
    // Resetting to 1.0 destroyed R29's adjustments every section boundary.
    _coherentShareEma = _prevCoherentShareEma * 0.5 + 0.25 * 0.5;
  }

  /**
   * R34 E6: Transition readiness diagnostic. Returns coupling gap (positive =
   * above threshold), velocity status, and whether velocity is the blocking
   * factor. R35 E5: Adds exploring-block diagnostic.
   * R37 E5/E6: Adds effectiveDim and rawRegimeMaxStreak.
  * @returns {{ gap: number, couplingStrength: number, coherentThreshold: number, velocity: number, velThreshold: number, thresholdScale: number, velocityBlocked: boolean, exploringBlock: string, coherentBlock: string, evolvingBeats: number, coherentBeats: number, runCoherentBeats: number, maxCoherentBeats: number, runBeatCount: number, runCoherentShare: number, forcedBreakCount: number, forcedRegime: string, forcedRegimeBeatsRemaining: number, forcedOverrideActive: boolean, forcedOverrideBeats: number, lastForcedReason: string, lastForcedTriggerStreak: number, lastForcedTriggerBeat: number, rawRegimeCounts: Record<string, number>, runRawRegimeCounts: Record<string, number>, rawRegimeMaxStreak: Record<string, number>, runResolvedRegimeCounts: Record<string, number>, effectiveDim: number }}
   */
  function getTransitionReadiness() {
    const li = _lastClassifyInputs;
    // R35 E5: Determine which condition blocks exploring entry
    // R36 E5: Use adaptive velocity threshold (0.010 after 100+ evolving beats)
    // R37 E3: Updated coupling gate from 0.40 to 0.50
    const _expVelThresh = _evolvingBeats > 100 ? 0.010 : 0.015;
    let exploringBlock = 'none';
    if (li.velocity <= _expVelThresh) exploringBlock = 'velocity';
    else if ((li.effectiveDim || 0) <= 2.5) exploringBlock = 'dimension';
    else if (li.couplingStrength > 0.50) exploringBlock = 'coupling';

    let coherentBlock = 'none';
    if (li.couplingStrength <= li.coherentThreshold) coherentBlock = 'coupling';
    else if (li.velocity <= li.velThreshold) coherentBlock = 'velocity';
    else if ((li.effectiveDim || 0) > 3.8) coherentBlock = 'dimension';

    return {
      gap: Number((li.couplingStrength - li.coherentThreshold).toFixed(4)),
      couplingStrength: Number(li.couplingStrength.toFixed(4)),
      coherentThreshold: Number(li.coherentThreshold.toFixed(4)),
      velocity: Number(li.velocity.toFixed(6)),
      velThreshold: li.velThreshold,
      thresholdScale: Number(coherentThresholdScale.toFixed(4)),
      velocityBlocked: li.couplingStrength > li.coherentThreshold && li.velocity <= li.velThreshold,
      exploringBlock,
      coherentBlock,
      evolvingBeats: _evolvingBeats,
      coherentBeats: coherentBeats,
      runCoherentBeats: _runCoherentBeats,
      maxCoherentBeats: _runMaxCoherentBeats,
      runBeatCount: _runBeatCount,
      runCoherentShare: Number(_runCoherentShare.toFixed(4)),
      forcedBreakCount: _forcedBreakCount,
      forcedRegime: _forcedRegime,
      forcedRegimeBeatsRemaining: _forcedRegimeBeatsRemaining,
      forcedOverrideActive: _forcedOverrideActive,
      forcedOverrideBeats: _forcedOverrideBeats,
      lastForcedReason: _lastForcedReason,
      lastForcedTriggerStreak: _lastForcedTriggerStreak,
      lastForcedTriggerBeat: _lastForcedTriggerBeat,
      rawRegimeCounts: Object.assign({}, _rawRegimeCounts),
      runRawRegimeCounts: Object.assign({}, _runRawRegimeCounts),
      // R37 E6: Max consecutive streak per raw regime
      rawRegimeMaxStreak: Object.assign({}, _rawRegimeMaxStreak),
      runResolvedRegimeCounts: Object.assign({}, _runResolvedRegimeCounts),
      // R37 E5: effectiveDim for histogram diagnostic
      effectiveDim: Number(((li.effectiveDim || 0)).toFixed(4))
    };
  }

  return { classify, resolve, grade, setOscillatingThreshold, getOscillatingThreshold, setCoherentThresholdScale, setCoherentShareAlphaMin, setEvolvingMinDwell, getExploringBeats, getLastRegime, getTransitionReadiness, reset };
})();
