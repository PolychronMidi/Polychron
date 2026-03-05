// regimeClassifier.js - Regime classification with hysteresis for system dynamics.
// Classifies the system's operating mode (stagnant, oscillating, coherent, exploring,
// drifting, fragmented, evolving) from trajectory metrics. Applies hysteresis to prevent
// single-beat noise from flip-flopping regime-reactive damping.
//
// Extracted from systemDynamicsProfiler.js for single-responsibility.

regimeClassifier = (() => {
  const V = validator.create('regimeClassifier');

  // Hysteresis: requires REGIME_HOLD consecutive beats of a new
  // classification before switching.
  // R36 E1: Reduced from 5 to 3. R35 had 639/702 beats where ALL exploring
  // conditions were met yet neither coherent nor exploring entered. With
  // gapAvg=+0.0985 but gapMin=-0.0149, ~5% of beats return raw!='coherent',
  // resetting the 5-consecutive counter. P(3 consecutive|95% positive) ~ 86%.
  const REGIME_HOLD = 3;

  // Profile-adaptive oscillating curvature threshold
  const OSCILLATING_CURVATURE_DEFAULT = 0.55;

  let lastRegime = 'evolving';
  let candidateRegime = 'evolving';
  let candidateCount = 0;
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

  // R36 E4: Raw regime diagnostic. Tallies how many beats each raw
  // classification appears (before hysteresis). Comparing rawRegimeCounts
  // vs resolved regimeCounts reveals hysteresis deadlock: if rawCoherent
  // is high but resolvedCoherent is 0, the 3-beat hysteresis is still
  // breaking the chain.
  const _rawRegimeCounts = {};

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
    const coherentDurationPenalty = lastRegime === 'coherent' && coherentBeats > 35
      ? clamp((coherentBeats - 35) * _dynamicPenaltyRate, 0, _dynamicPenaltyCap)
      : 0;

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
    // R36 E2: effectiveDim gate on coherent entry. Coherent means "dimensions
    // move together" which implies low effective dimensionality. When effectiveDim
    // > 4.0, the system has 4+ independent degrees of freedom - that's exploring
    // territory even if coupling exceeds the (very low) threshold. In R35, 639/702
    // beats had ALL exploring conditions met, but coherent's low threshold (~0.07)
    // absorbed them all. This gate opens the exploring pathway by letting high-dim
    // beats fall through to the exploring check instead.
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
    const _exploringVelThreshold = _evolvingBeats > 100 ? 0.010 : 0.015;
    if (avgVelocity > _exploringVelThreshold && effectiveDim > 2.5 && couplingStrength <= 0.40) return 'exploring';
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
   * Apply hysteresis to regime transitions.
   * Requires REGIME_HOLD consecutive beats of a new classification before switching.
   * @param {string} rawRegime - instantaneous classification from classify()
   * @returns {string} - stable regime with hysteresis
   */
  function resolve(rawRegime) {
    // R36 E4: Tally raw regime classifications before hysteresis
    _rawRegimeCounts[rawRegime] = (_rawRegimeCounts[rawRegime] || 0) + 1;
    if (rawRegime === lastRegime) {
      candidateRegime = rawRegime;
      candidateCount = 0;
      if (lastRegime === 'exploring') {
        exploringBeats++;
        coherentBeats = 0;
        _evolvingBeats = 0;
      } else if (lastRegime === 'coherent') {
        coherentBeats++;
        exploringBeats = 0;
        _evolvingBeats = 0;
      } else if (lastRegime === 'evolving') {
        _evolvingBeats++;
        exploringBeats = 0;
        coherentBeats = 0;
      } else {
        exploringBeats = 0;
        coherentBeats = 0;
        _evolvingBeats = 0;
      }
      return lastRegime;
    }
    if (rawRegime === candidateRegime) {
      candidateCount++;
      if (candidateCount >= REGIME_HOLD) {
        // R22 E4: Evolving minimum dwell -- suppress evolving->coherent until
        // at least _evolvingMinDwell beats have passed in evolving. In R22,
        // the system passed through evolving in only 7 beats before snapping
        // to coherent. This ensures evolving ideas develop for >= 12 beats.
        if (lastRegime === 'evolving' && rawRegime === 'coherent' && _evolvingBeats < _evolvingMinDwell) {
          // Force continuation in evolving -- don't allow transition yet.
          // Reset candidate so hysteresis re-counts from scratch after dwell.
          candidateCount = 0;
          return lastRegime;
        }
        // R25 E6: Regime transition diagnostic. Emits coupling/threshold/gap
        // at the moment of transition for post-run verification of proximity
        // seeding and coherent-entry mechanics.
        explainabilityBus.emit('REGIME_TRANSITION', 'both', {
          from: lastRegime, to: rawRegime,
          coupling: _lastClassifyInputs.couplingStrength,
          threshold: _lastClassifyInputs.coherentThreshold,
          proximityBonus: _lastClassifyInputs.evolvingProximityBonus,
          gap: _lastClassifyInputs.couplingStrength - _lastClassifyInputs.coherentThreshold,
          exploringBeats, evolvingBeats: _evolvingBeats
        });
        if (lastRegime === 'exploring') exploringBeats = 0;
        // R28 E5: Activate coherent momentum on coherent->non-coherent transition.
        // Provides 15-beat decaying threshold bonus to prevent premature exit.
        if (lastRegime === 'coherent') {
          coherentBeats = 0;
          _coherentMomentumBeats = _COHERENT_MOMENTUM_WINDOW;
        }
        if (lastRegime === 'evolving') _evolvingBeats = 0;
        lastRegime = rawRegime;
        candidateCount = 0;
        return rawRegime;
      }
    } else {
      candidateRegime = rawRegime;
      candidateCount = 1;
    }
    return lastRegime;
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
    candidateRegime = 'evolving';
    candidateCount = 0;
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
  * @returns {{ gap: number, couplingStrength: number, coherentThreshold: number, velocity: number, velThreshold: number, thresholdScale: number, velocityBlocked: boolean, exploringBlock: string, rawRegimeCounts: Record<string, number> }}
   */
  function getTransitionReadiness() {
    const li = _lastClassifyInputs;
    // R35 E5: Determine which condition blocks exploring entry
    // R36 E5: Use adaptive velocity threshold (0.010 after 100+ evolving beats)
    const _expVelThresh = _evolvingBeats > 100 ? 0.010 : 0.015;
    let exploringBlock = 'none';
    if (li.velocity <= _expVelThresh) exploringBlock = 'velocity';
    else if ((li.effectiveDim || 0) <= 2.5) exploringBlock = 'dimension';
    else if (li.couplingStrength > 0.40) exploringBlock = 'coupling';
    return {
      gap: Number((li.couplingStrength - li.coherentThreshold).toFixed(4)),
      couplingStrength: Number(li.couplingStrength.toFixed(4)),
      coherentThreshold: Number(li.coherentThreshold.toFixed(4)),
      velocity: Number(li.velocity.toFixed(6)),
      velThreshold: li.velThreshold,
      thresholdScale: Number(coherentThresholdScale.toFixed(4)),
      velocityBlocked: li.couplingStrength > li.coherentThreshold && li.velocity <= li.velThreshold,
      exploringBlock,
      rawRegimeCounts: Object.assign({}, _rawRegimeCounts)
    };
  }

  return { classify, resolve, grade, setOscillatingThreshold, getOscillatingThreshold, setCoherentThresholdScale, setCoherentShareAlphaMin, setEvolvingMinDwell, getExploringBeats, getLastRegime, getTransitionReadiness, reset };
})();
