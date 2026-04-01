// stutterVariants.js - registry and per-beat selector for stutter note variants.
// Each variant self-registers. The selector picks one per beat based on regime,
// density, and randomness. Falls back to default stutterNotes when no variant fires.

stutterVariants = (() => {
  const V = validator.create('stutterVariants');
  const registered = new Map();
  let activeVariant = null;
  let activeVariantName = null;
  let lastBeat = -1;
  let sectionStutterCount = 0;
  /** @type {number[]|null} */ let activePattern = null;
  let patternStepIndex = 0;
  let prevRegime = 'exploring';
  let blendFromRegime = 'exploring';
  let regimeTransitionBeats = 0;
  const REGIME_BLEND_DURATION = 8;
  let prevEntropyEma = 0.5;
  const ENTROPY_EMA_ALPHA = 0.25;
  // R24: stutter call-response - cross-layer variant conversation
  const lastVariantPerLayer = { L1: null, L2: null };
  const CALL_RESPONSE_MAP = {
    machineGun: { ghostStutter: 1.8, rhythmicGrid: 1.5 },
    ghostStutter: { rhythmicGrid: 1.6, echoTrail: 1.4 },
    rhythmicGrid: { harmonicShadow: 1.5, stereoWidthModulation: 1.3 },
    octaveCascade: { decayingBounce: 1.6, reverseVelocity: 1.4 },
    stutterTremolo: { ghostStutter: 1.8, echoTrail: 1.5 },
    stutterSwarm: { ghostStutter: 1.6, rhythmicDotted: 1.4 },
    tensionStutter: { harmonicShadow: 1.5, ghostStutter: 1.3 },
    convergenceBurst: { rhythmicGrid: 1.5, decayingBounce: 1.3 }
  };

  // Regime weight multipliers: which variants suit which musical context
  const REGIME_WEIGHTS = {
    coherent:   { ghostStutter: 1.8, rhythmicGrid: 1.5, decayingBounce: 1.2, reverseVelocity: 0.8, octaveCascade: 0.6, machineGun: 0.3, stutterSwarm: 0.5, stutterTremolo: 0.4, stereoScatter: 1.0, harmonicShadow: 1.4, densityReactive: 0.8, echoTrail: 1.2, rhythmicDotted: 1.3, flickerStutter: 0.6, convergenceBurst: 1.8, tensionStutter: 0.7, directionalOscillation: 0.8, stereoWidthModulation: 1.0 },
    exploring:  { ghostStutter: 0.6, rhythmicGrid: 0.7, decayingBounce: 0.8, reverseVelocity: 1.2, octaveCascade: 1.3, machineGun: 1.6, stutterSwarm: 1.4, stutterTremolo: 1.5, stereoScatter: 1.2, harmonicShadow: 0.8, densityReactive: 1.3, echoTrail: 0.9, rhythmicDotted: 0.8, flickerStutter: 1.5, convergenceBurst: 0.5, tensionStutter: 1.3, directionalOscillation: 1.3, stereoWidthModulation: 1.2 },
    evolving:   { ghostStutter: 1.0, rhythmicGrid: 1.0, decayingBounce: 1.3, reverseVelocity: 1.1, octaveCascade: 1.2, machineGun: 0.7, stutterSwarm: 0.9, stutterTremolo: 0.8, stereoScatter: 1.0, harmonicShadow: 1.2, densityReactive: 1.1, echoTrail: 1.3, rhythmicDotted: 1.1, flickerStutter: 1.0, convergenceBurst: 1.0, tensionStutter: 1.2, directionalOscillation: 1.2, stereoWidthModulation: 1.1 },
    oscillating:{ ghostStutter: 0.8, rhythmicGrid: 1.2, decayingBounce: 1.0, reverseVelocity: 1.3, octaveCascade: 1.0, machineGun: 1.0, stutterSwarm: 1.1, stutterTremolo: 1.2, stereoScatter: 1.1, harmonicShadow: 0.9, densityReactive: 1.0, echoTrail: 1.0, rhythmicDotted: 1.2, flickerStutter: 1.3, convergenceBurst: 0.7, tensionStutter: 1.4, directionalOscillation: 1.1, stereoWidthModulation: 1.2 }
  };

  /**
   * @param {string} name
   * @param {Function} fn
   * @param {number} [weight] - base selection weight (higher = more likely)
   * @param {{ selfGate?: number, maxPerSection?: number }} [opts]
   *   selfGate: 0-1 multiplier on per-step gate (lower = fewer steps emit)
   *   maxPerSection: cap total stutter invocations per section for this variant
   */
  function register(name, fn, weight, opts) {
    V.assertNonEmptyString(name, 'name');
    V.requireType(fn, 'function', 'fn');
    const selfGate = (opts && Number.isFinite(opts.selfGate)) ? opts.selfGate : 1.0;
    const maxPerSection = (opts && Number.isFinite(opts.maxPerSection)) ? opts.maxPerSection : Infinity;
    registered.set(name, { fn, weight: V.optionalFinite(weight, 1.0), selfGate, maxPerSection });
  }

  function getVariant(name) {
    const entry = registered.get(name);
    return entry ? entry.fn : null;
  }

  function getNames() { return Array.from(registered.keys()); }

  /** Get the selfGate multiplier for the active variant, dynamically adjusted
   *  by the emitted/scheduled ratio. When steps are mostly gated out, ease up.
   *  When flooding, tighten. */
  function getActiveSelfGate() {
    if (!activeVariantName) return 1.0;
    const entry = registered.get(activeVariantName);
    if (!entry) return 1.0;
    const metrics = stutterMetrics.getMetrics();
    const scheduled = m.max(1, metrics.scheduledCount);
    const emitted = metrics.emittedCount;
    const ratio = emitted / scheduled;
    // ratio < 0.3 = most steps gated out, ease selfGate up by 20%
    // ratio > 0.7 = most steps emitting, tighten selfGate by 15%
    const adjustment = ratio < 0.3 ? 1.2 : ratio > 0.7 ? 0.85 : 1.0;
    return clamp(entry.selfGate * adjustment, 0.15, 1.0);
  }

  /**
   * Check if the active variant has hit its per-section cap.
   * Returns true if the invocation should be skipped.
   */
  function shouldThrottle() {
    if (!activeVariantName) return false;
    const entry = registered.get(activeVariantName);
    if (!entry || entry.maxPerSection === Infinity) return false;
    return sectionStutterCount >= entry.maxPerSection;
  }

  /** Increment section stutter counter. Called per stutter invocation. */
  function incSectionCount() { sectionStutterCount++; }

  /**
   * Select a variant for this beat. Called from StutterManager.prepareBeat.
   * Weighted random selection. Returns the chosen variant function or null
   * (null = use default stutterNotes).
   */
  function selectForBeat() {
    if (beatIndex === lastBeat) return activeVariant;
    lastBeat = beatIndex;
    patternStepIndex = 0;

    // R18: pattern gating legendary across all profiles/regimes/densities.
    // R19: uses full patterns.js selection. Activation scales with composite
    // intensity - sparse passages get fewer patterns, climactic sections more.
    const sigs = safePreBoot.call(() => conductorSignalBridge.getSignals(), null);
    const compositeIntensity = sigs ? clamp((sigs.compositeIntensity || 0.5), 0, 1) : 0.5;
    const patternActivationProb = clamp(0.55 + compositeIntensity * 0.35, 0.45, 0.90);
    if (rf() < patternActivationProb) {
      const patternLen = ri(4, 12);
      const roll = rf();
      if (roll < 0.30) {
        const ones = m.max(1, m.round(patternLen * rf(0.25, 0.6)));
        activePattern = euclid(patternLen, ones);
      } else if (roll < 0.50) {
        activePattern = binary(patternLen);
      } else if (roll < 0.65) {
        activePattern = hex(patternLen);
      } else if (roll < 0.78) {
        activePattern = random(patternLen, rf(0.3, 0.7));
      } else if (roll < 0.88) {
        activePattern = onsets({ make: [patternLen, () => [1, ri(2, 4)]] });
      } else if (activePattern && activePattern.length > 0) {
        // Rotate or morph the previous pattern for continuity
        activePattern = rf() < 0.5
          ? rotate(activePattern, ri(2), '?', patternLen)
          : morph(activePattern, '?', patternLen);
      } else {
        activePattern = euclid(patternLen, m.max(1, m.round(patternLen * rf(0.3, 0.5))));
      }
    } else {
      activePattern = null;
    }

    if (registered.size === 0) { activeVariant = null; activeVariantName = null; return null; }

    // Phase multipliers: suppress dense variants in resolution/coda, boost in climax
    const PHASE_DENSE_MULT = {
      intro: 0.5, opening: 0.6, exposition: 0.8, development: 1.0,
      climax: 1.4, resolution: 0.5, conclusion: 0.4, coda: 0.3
    };
    const DENSE_VARIANTS = new Set(['machineGun', 'stutterTremolo', 'stutterSwarm', 'convergenceBurst']);

    // Regime-aware + phase-aware weighted selection with transition blending
    const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const regime = (snap && snap.regime) ? snap.regime : 'exploring';
    if (regime !== prevRegime) {
      blendFromRegime = prevRegime;
      regimeTransitionBeats = 0;
      prevRegime = regime;
    }
    regimeTransitionBeats++;
    const currentMap = REGIME_WEIGHTS[regime] || REGIME_WEIGHTS.evolving;
    const fromMap = REGIME_WEIGHTS[blendFromRegime] || REGIME_WEIGHTS.evolving;
    const blendT = clamp(regimeTransitionBeats / REGIME_BLEND_DURATION, 0, 1);
    // Interpolate regime weights during transition
    /** @type {Record<string, number>} */
    const regimeMap = {};
    for (const key of Object.keys(currentMap)) {
      const cur = currentMap[key] || 1.0;
      const from = fromMap[key] || 1.0;
      regimeMap[key] = from + (cur - from) * blendT;
    }
    const phase = safePreBoot.call(() => harmonicContext.getField('sectionPhase'), 'development');
    const phaseDenseMult = PHASE_DENSE_MULT[phase] || 1.0;

    // R16: hocket mode favors rhythmic/subtle variants that complement interleaving
    const HOCKET_WEIGHTS = { ghostStutter: 1.5, rhythmicGrid: 1.4, rhythmicDotted: 1.4, harmonicShadow: 1.2, machineGun: 0.5, stutterTremolo: 0.5, stutterSwarm: 0.6 };
    const rhythmMode = safePreBoot.call(() => rhythmicComplementEngine.getMode(), 'free');
    const inHocket = rhythmMode === 'hocket';

    // R18: articulation-aware variant selection. Staccato passages favor
    // rhythmic/grid variants, legato passages favor ghost/echoTrail/harmonicShadow
    const STACCATO_WEIGHTS = { rhythmicGrid: 1.4, rhythmicDotted: 1.4, machineGun: 1.3, decayingBounce: 1.2, ghostStutter: 0.7, echoTrail: 0.6, harmonicShadow: 0.7 };
    const LEGATO_WEIGHTS = { ghostStutter: 1.5, echoTrail: 1.4, harmonicShadow: 1.3, stereoScatter: 1.2, machineGun: 0.5, stutterTremolo: 0.5, rhythmicGrid: 0.7 };
    const activeLayer = /** @type {string} */ (safePreBoot.call(() => LM.activeLayer, 'L1'));
    const artProfile = safePreBoot.call(() => articulationComplement.getArticulationProfile(activeLayer), null);

    // R21: harmonic journey distance biases variant character.
    // Near home = subtle variants, far = dramatic
    const JOURNEY_SUBTLE = { ghostStutter: 1.4, echoTrail: 1.3, harmonicShadow: 1.2, rhythmicGrid: 1.1 };
    const JOURNEY_DRAMATIC = { octaveCascade: 1.5, machineGun: 1.3, stutterSwarm: 1.4, directionalOscillation: 1.3, stutterTremolo: 1.2 };
    const journeyStop = safePreBoot.call(() => harmonicJourney.getStop(sectionIndex), null);
    const journeyDist = (journeyStop && Number.isFinite(journeyStop.distance)) ? journeyStop.distance : 0;
    const journeyFar = journeyDist > 3;

    // R23: phrase boundary fills - boost decayingBounce/machineGun in last 12% of phrase
    const phraseProgress = /** @type {number} */ (safePreBoot.call(() => timeStream.normalizedProgress('phrase'), 0.5));
    const PHRASE_BOUNDARY_WEIGHTS = { decayingBounce: 2.0, machineGun: 1.5, rhythmicGrid: 1.3 };
    const atPhraseBoundary = Number.isFinite(phraseProgress) && phraseProgress > 0.88;

    // R24: stutter call-response - other layer's last variant biases this layer's selection
    const crLayer = /** @type {string} */ (safePreBoot.call(() => LM.activeLayer, 'L1'));
    const crOtherLayer = crLayer === 'L1' ? 'L2' : 'L1';
    const otherLastVariant = lastVariantPerLayer[crOtherLayer];
    const responseWeights = (otherLastVariant && CALL_RESPONSE_MAP[otherLastVariant]) ? CALL_RESPONSE_MAP[otherLastVariant] : {};

    // R24: entropy reversal detection - sudden entropy drops trigger dramatic variants
    const currentEntropy = /** @type {number} */ (safePreBoot.call(() => entropyRegulator.measureEntropy(), 0.5));
    const entropyVal = Number.isFinite(currentEntropy) ? currentEntropy : 0.5;
    const entropyDelta = prevEntropyEma - entropyVal;
    prevEntropyEma += (entropyVal - prevEntropyEma) * ENTROPY_EMA_ALPHA;
    const entropyReversal = entropyDelta > 0.12;
    const ENTROPY_REVERSAL_WEIGHTS = { machineGun: 2.0, stutterSwarm: 1.8, octaveCascade: 1.6, stutterTremolo: 1.5 };

    // R24: coupling label reactive stutter - system's self-description drives variant character
    const COUPLING_LABEL_WEIGHTS = {
      'rhythmic-shimmer': { stereoWidthModulation: 2.0, ghostStutter: 1.8, flickerStutter: 1.5 },
      'agitated-tension': { machineGun: 1.8, tensionStutter: 2.0, stutterTremolo: 1.5 },
      'smooth-tension': { echoTrail: 1.8, harmonicShadow: 1.5, ghostStutter: 1.3 },
      'chaotic-proliferation': { machineGun: 2.0, stutterSwarm: 1.8, octaveCascade: 1.5 },
      'phase-aligned-density': { rhythmicGrid: 1.8, rhythmicDotted: 1.5, convergenceBurst: 1.3 },
      'phase-opposed-density': { directionalOscillation: 1.5, reverseVelocity: 1.3 },
      'tension-drives-density': { tensionStutter: 1.6, decayingBounce: 1.4 },
      'stable-variety': { ghostStutter: 1.4, echoTrail: 1.3, harmonicShadow: 1.2 }
    };
    const profSnap = /** @type {any} */ (safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null));
    /** @type {Record<string, number>} */
    const labelMults = {};
    if (profSnap && profSnap.couplingLabels) {
      for (const label of Object.values(profSnap.couplingLabels)) {
        const w = COUPLING_LABEL_WEIGHTS[/** @type {string} */ (label)];
        if (w) { for (const [vn, vm] of Object.entries(w)) { labelMults[vn] = (labelMults[vn] || 1.0) * vm; } }
      }
    }

    // R16: default weight reduced 2.0->1.2
    const pool = [{ name: null, fn: null, weight: 1.2 }];
    for (const [name, entry] of registered) {
      const regimeMult = regimeMap[name] || 1.0;
      const phaseMult = DENSE_VARIANTS.has(name) ? phaseDenseMult : 1.0;
      const hocketMult = inHocket ? (HOCKET_WEIGHTS[name] || 1.0) : 1.0;
      const artMult = artProfile
        ? (artProfile.isStaccato ? (STACCATO_WEIGHTS[name] || 1.0)
          : artProfile.isLegato ? (LEGATO_WEIGHTS[name] || 1.0) : 1.0)
        : 1.0;
      const journeyMult = journeyFar ? (JOURNEY_DRAMATIC[name] || 1.0) : (journeyDist < 1.5 ? (JOURNEY_SUBTLE[name] || 1.0) : 1.0);
      const boundaryMult = atPhraseBoundary ? (PHRASE_BOUNDARY_WEIGHTS[name] || 1.0) : 1.0;
      const labelMult = labelMults[name] || 1.0;
      const entropyMult = entropyReversal ? (ENTROPY_REVERSAL_WEIGHTS[name] || 1.0) : 1.0;
      const responseMult = responseWeights[name] || 1.0;
      pool.push({ name, fn: entry.fn, weight: entry.weight * regimeMult * phaseMult * hocketMult * artMult * journeyMult * boundaryMult * labelMult * entropyMult * responseMult });
    }
    let totalWeight = 0;
    for (let i = 0; i < pool.length; i++) totalWeight += pool[i].weight;

    let roll = rf() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) {
        activeVariant = pool[i].fn;
        activeVariantName = pool[i].name;
        lastVariantPerLayer[crLayer] = activeVariantName;
        return activeVariant;
      }
    }
    activeVariant = null;
    activeVariantName = null;
    return null;
  }

  function getActive() { return activeVariant; }
  function getActiveName() { return activeVariantName; }

  /**
   * Check the pattern gate for the current step. Returns true if the step
   * should emit, false if silenced. When no pattern is active, always returns
   * true (falls through to probabilistic gating).
   */
  function patternGate() {
    if (!activePattern) return true;
    const idx = patternStepIndex % activePattern.length;
    patternStepIndex++;
    return activePattern[idx] === 1;
  }

  function reset() {
    activeVariant = null;
    activeVariantName = null;
    lastBeat = -1;
    sectionStutterCount = 0;
  }

  function resetSection() {
    sectionStutterCount = 0;
  }

  // Register as a closed-loop feedback controller so feedbackRegistry tracks
  // and dampens the stutter variant selection loop
  safePreBoot.call(() => {
    closedLoopController.create({
      name: 'stutterVariantFeedback',
      observe: () => stutterFeedbackListener.getIntensity().overall,
      target: () => 0.3,
      gain: 0.15,
      smoothing: 0.4,
      clampRange: [0.5, 1.5],
      sourceDomain: 'stutter_density',
      targetDomain: 'stutter_variant_selection'
    });
  }, null);

  return { register, getVariant, getNames, selectForBeat, getActive, getActiveName,
    getActiveSelfGate, shouldThrottle, incSectionCount, patternGate, reset, resetSection };
})();
