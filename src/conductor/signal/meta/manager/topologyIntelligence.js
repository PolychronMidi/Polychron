// topologyIntelligence.js -- coupling topology intelligence layer.
// Perceives the full correlation matrix as a topology, classifies its
// emergent phase, detects regime-topology cross-states, tracks compositional
// trajectory, recognizes attractors via fingerprint similarity, and
// modulates downstream controllers via topology-derived multipliers.

hyperMetaManagerTopology = (() => {
  const ST = hyperMetaManagerState;
  const S  = ST.S;

  /**
   * Compute normalized Shannon entropy of the coupling correlation matrix.
   * High entropy = balanced coupling landscape, low = dominated by few pairs.
   * @param {Record<string, number>} matrix
   * @returns {number} normalized entropy [0, 1]
   */
  function computeTopologyEntropy(matrix) {
    const pairs = Object.keys(matrix);
    if (pairs.length < 2) return 0.5;

    let totalAbs = 0;
    const absValues = [];
    for (let i = 0; i < pairs.length; i++) {
      const v = Number(matrix[pairs[i]]);
      if (!Number.isFinite(v)) continue;
      const a = m.abs(v) + 0.001;
      absValues.push(a);
      totalAbs += a;
    }
    if (absValues.length < 2 || totalAbs < 0.01) return 0.5;

    let entropy = 0;
    for (let i = 0; i < absValues.length; i++) {
      const p = absValues[i] / totalAbs;
      if (p > 0) entropy -= p * (m.log(p) / m.LN2);
    }

    const maxEntropy = m.log(absValues.length) / m.LN2;
    return maxEntropy > 0 ? clamp(entropy / maxEntropy, 0, 1) : 0.5;
  }

  /**
   * Classify the coupling topology phase from its entropy.
   * @param {number} normalizedEntropy [0, 1]
   * @returns {'crystallized' | 'resonant' | 'fluid'}
   */
  function classifyTopologyPhase(normalizedEntropy) {
    if (normalizedEntropy < 0.50) return 'crystallized';
    if (normalizedEntropy < 0.72) return 'resonant';
    return 'fluid';
  }

  /**
   * Determine the regime-topology cross-state.
   * emergence: exploring + resonant -- novel self-coherent patterns forming.
   * locked: coherent + crystallized -- stasis risk.
   * dampened: oscillating overrides everything.
   * seeking: default normal control.
   * @param {string} regime
   * @param {'crystallized' | 'resonant' | 'fluid'} topPhase
   * @param {'converging' | 'oscillating' | 'stabilized'} sysPhase
   * @returns {'emergence' | 'locked' | 'seeking' | 'dampened'}
   */
  function computeCrossState(regime, topPhase, sysPhase) {
    if (sysPhase === 'oscillating') return 'dampened';
    if (regime === 'exploring' && topPhase === 'resonant') return 'emergence';
    if (regime === 'evolving' && topPhase === 'resonant' && sysPhase === 'stabilized') return 'emergence';
    if (regime === 'coherent' && topPhase === 'crystallized') return 'locked';
    return 'seeking';
  }

  /**
   * Quantize the coupling matrix into a discrete fingerprint for attractor detection.
   * @param {Record<string, number>} matrix
   * @returns {Record<string, number>} quantized fingerprint (values: -2,-1,0,1,2)
   */
  function quantizeFingerprint(matrix) {
    const fp = Object.create(null);
    const pairs = Object.keys(matrix);
    for (let i = 0; i < pairs.length; i++) {
      const v = Number(matrix[pairs[i]]);
      if (!Number.isFinite(v)) { fp[pairs[i]] = 0; continue; }
      if (v < -0.30)      fp[pairs[i]] = -2;
      else if (v < -0.08) fp[pairs[i]] = -1;
      else if (v <= 0.08) fp[pairs[i]] = 0;
      else if (v <= 0.30) fp[pairs[i]] = 1;
      else                fp[pairs[i]] = 2;
    }
    return fp;
  }

  /**
   * Compute similarity between two topology fingerprints.
   * @param {Record<string, number>} fpA
   * @param {Record<string, number>} fpB
   * @returns {number} [0, 1] where 1 = identical topology shape
   */
  function fingerprintSimilarity(fpA, fpB) {
    const keysA = Object.keys(fpA);
    if (keysA.length === 0) return 0;
    let matches = 0, total = 0;
    for (let i = 0; i < keysA.length; i++) {
      const key = keysA[i];
      if (key in fpB) {
        total++;
        if (fpA[key] === fpB[key]) matches++;
        else if (m.abs(fpA[key] - fpB[key]) === 1) matches += 0.5;
      }
    }
    return total > 0 ? matches / total : 0;
  }

  /**
   * Full topology intelligence update. Called every orchestration tick.
   * @param {ReturnType<typeof hyperMetaManagerHealth.gatherControllerState>} state
   */
  function update(state) {
    if (!state.profiler || !state.profiler.couplingMatrix) return;

    const matrix = state.profiler.couplingMatrix;
    const regime = state.profiler.regime || 'initializing';

    // 1. Topology entropy
    const rawEntropy = computeTopologyEntropy(matrix);
    S.topologyEntropyEma += (rawEntropy - S.topologyEntropyEma) * 0.12;

    // 2. Classify topology phase
    S.topologyPhase = classifyTopologyPhase(S.topologyEntropyEma);

    // 3. Regime-topology cross-state
    S.crossState = computeCrossState(regime, S.topologyPhase, S.systemPhase);

    // 4. Track emergence streak
    if (S.crossState === 'emergence') S.emergenceStreak++;
    else S.emergenceStreak = 0;

    // 5. Attractor detection via fingerprint similarity
    const fp = quantizeFingerprint(matrix);
    const prevKeys = Object.keys(ST.prevFingerprint);
    if (prevKeys.length > 0) {
      const similarity = fingerprintSimilarity(fp, ST.prevFingerprint);
      S.attractorSimilarityEma += (similarity - S.attractorSimilarityEma) * 0.10;

      if (S.attractorSimilarityEma > 0.70) {
        S.attractorStabilityBeats += ST.ORCHESTRATE_INTERVAL;
      } else {
        S.attractorStabilityBeats = m.max(0,
          S.attractorStabilityBeats - ST.ORCHESTRATE_INTERVAL * 0.5);
      }
    }
    // Update fingerprint
    const fpKeys = Object.keys(fp);
    for (let i = 0; i < fpKeys.length; i++) ST.prevFingerprint[fpKeys[i]] = fp[fpKeys[i]];

    // 6. Topology-derived multipliers
    updateCreativityMultiplier();
    updateInterventionBudgetScale();

    ST.rateMultipliers.topologyCreativity = S.topologyCreativityMultiplier;
    ST.rateMultipliers.interventionBudget =
      ST.INTERVENTION_BUDGET * S.interventionBudgetScale;

    // 7. Section trajectory tracking
    const sectionIdx = Number.isFinite(sectionIndex) ? sectionIndex : -1;
    if (sectionIdx !== S.currentSection && sectionIdx >= 0) {
      ST.trajectory.push({
        section: S.currentSection,
        phase: S.topologyPhase,
        entropy: m.round(S.topologyEntropyEma * 1000) / 1000,
        crossState: S.crossState,
      });
      // Stasis detection: same phase for 3+ consecutive sections
      if (ST.trajectory.length >= 3) {
        const recent = ST.trajectory.slice(-3);
        if (recent[0].phase === recent[1].phase && recent[1].phase === recent[2].phase) {
          ST.rateMultipliers.global *= 0.92;
        }
      }
      S.currentSection = sectionIdx;
    }
  }

  function updateCreativityMultiplier() {
    if (S.crossState === 'emergence') {
      const streakBonus = clamp(S.emergenceStreak * 0.01, 0, 0.10);
      const attractorBonus = S.attractorStabilityBeats > 50 ? 0.05 : 0;
      // Audit: 1.12-1.30x fixed during emergence, no health gate.
      // Scale emergence boost by system health: full 1.12-1.30x when healthy,
      // down to 1.0-1.15x when stressed. Uses same e18Scale from hyperMetaManager
      // but topology doesn't have direct access -- use S.healthEma and exceedanceTrendEma.
      const topoHealthScale = clamp(S.healthEma / 0.7, 0.5, 1.0);
      const topoExceedanceScale = clamp(1.0 - m.max(0, S.exceedanceTrendEma - 0.4) * 1.5, 0.5, 1.0);
      const topoE18Scale = topoHealthScale * topoExceedanceScale;
      const rawBoost = 1.12 + streakBonus + attractorBonus; // 1.12 to 1.27
      // Scale the overage above 1.0 by health: stressed = less boost
      S.topologyCreativityMultiplier = clamp(1.0 + (rawBoost - 1.0) * topoE18Scale, 1.0, 1.30);
    } else if (S.crossState === 'locked') {
      S.topologyCreativityMultiplier =
        clamp(0.85 - (S.attractorStabilityBeats > 100 ? 0.05 : 0), 0.75, 1.0);
    } else if (S.crossState === 'dampened') {
      S.topologyCreativityMultiplier = 0.95;
    } else {
      // seeking: relax toward neutral
      S.topologyCreativityMultiplier += (1.0 - S.topologyCreativityMultiplier) * 0.15;
    }
  }

  function updateInterventionBudgetScale() {
    if (S.crossState === 'emergence') {
      S.interventionBudgetScale = clamp(S.interventionBudgetScale * 0.97, 0.40, 1.0);
    } else if (S.crossState === 'locked') {
      S.interventionBudgetScale = clamp(S.interventionBudgetScale * 1.03, 0.40, 1.20);
    } else {
      S.interventionBudgetScale += (1.0 - S.interventionBudgetScale) * 0.08;
    }
  }

  return { update };
})();
