// hyperMetaManagerEvolutions.js -- E1-E13, E18-E21, E23 evolution logic.
// Extracted from hyperMetaManager tick() to keep the orchestrator file concise.
// Called once per orchestration tick with the gathered controller state.

moduleLifecycle.declare({
  name: 'hyperMetaManagerEvolutions',
  subsystem: 'conductor',
  deps: ['signalReader', 'timeStream'],
  provides: ['hyperMetaManagerEvolutions'],
  init: (deps) => {
  const signalReader = deps.signalReader;
  const timeStream = deps.timeStream;
  const ST     = hyperMetaManagerState;
  const S      = ST.S;
  const health = hyperMetaManagerHealth;

  /**
   * Apply all active evolutions for this orchestration tick.
   * @param {ReturnType<typeof hyperMetaManagerHealth.gatherControllerState>} state
   * @param {number} e18Scale
   */
  function applyEvolutions(state, e18Scale) {
    // Layer-specific numerator: evolutions always run on L1 (tick returns early for L2),
    // but reading from the active layer's timing object is explicit about the source.
    const layerNumerator = LM.activeLayer && LM.layers[LM.activeLayer] ? LM.layers[LM.activeLayer].numerator : 4;

    // 14. E1-E5 Evolutions orchestration
    // E1: Hotspot monopoly relief
    // Audit: 4.0x coefficient with no health gate could amplify above safe levels
    // under stress. Scale coefficient by e18Scale (health+exceedance awareness).
    // At full health (e18Scale=1.0): 4.0x max (calibrated). Stressed: 2.0x max.
    const monopoly = health.getPairMonopoly();
    if (monopoly) {
      const e1Coefficient = 2.0 + 2.0 * S.e18ScaleEma; // 2.0x stressed -> 4.0x healthy (ramped)
      ST.rateMultipliers['hotspotMonopolyRelief_' + monopoly.pair] =
        1.0 + (monopoly.share - 0.75) * e1Coefficient;
    }
    const rmKeys = Object.keys(ST.rateMultipliers);
    for (let ri = 0; ri < rmKeys.length; ri++) {
      if (rmKeys[ri].indexOf('hotspotMonopolyRelief_') === 0) {
        if (!monopoly || rmKeys[ri] !== 'hotspotMonopolyRelief_' + monopoly.pair) {
          ST.rateMultipliers[rmKeys[ri]] *= 0.8;
          if (ST.rateMultipliers[rmKeys[ri]] < 1.01) delete ST.rateMultipliers[rmKeys[ri]];
        }
      }
    }

    // E2: Homeostasis stress detection
    if (state.homeostasis) {
      const ggm = state.homeostasis.globalGainMultiplier;
      if (typeof ggm === 'number' && ggm < 0.65) {
        const stressDampen = clamp(1.0 - (0.65 - ggm) * 2.0, 0.7, 1.0);
        ST.rateMultipliers.global *= stressDampen;
      }
    }


    // E4: Section-aware tension floor protection
    // Audit: 2.5x max amplifying with no health gate. When stressed, aggressive
    // tension amplification can overshoot. Scale max by e18Scale: 2.5x healthy,
    // down to 1.75x when stressed. Base 1.5x always preserved (minimum protection).
    {
      let secProg = 0;
      secProg = clamp(/** @type {number} */ (timeStream.compoundProgress("section")), 0, 1);
      const currentTension = /** @type {number} */ (signalReader.tension());
      if (secProg < 0.3 && currentTension < 0.75) {
        const e4MaxProtection = 1.5 + S.e18ScaleEma; // 1.5 stressed -> 2.5 healthy (ramped)
        ST.rateMultipliers.tensionFloorProtection = clamp(1.5 + (0.75 - currentTension) * 2.0, 1.5, e4MaxProtection);
      } else {
        ST.rateMultipliers.tensionFloorProtection =
          m.max(1.0, (ST.rateMultipliers.tensionFloorProtection) * 0.9);
      }
    }

    // E5: Phase fatigue escalation
    // Audit: 2.5x max uncapped continuous escalation, no health gate. When system
    // is stressed, aggressive phase exemption competes with other controllers.
    // Health-gate the max: 2.5x when healthy, 1.5x when stressed. This preserves
    // the escalation mechanism but prevents runaway amplification under load.
    if (state.phaseFloor && state.phaseFloor.shareEma < (state.phaseFloor.collapseThreshold ?? 0.05)) {
      // Health gate: only accumulate fatigue when system is stable enough to act on it.
      // Stressed systems (healthEma <= 0.75) skip accumulation -- the E5 escalation
      // would compete with other controllers and overshoot during recovery.
      if (S.healthEma > ST.HEALTH_GATE_E5_ACCUM) {
        S.phaseFatigueBeats = m.min(S.phaseFatigueBeats + ST.ORCHESTRATE_INTERVAL, ST.PHASE_FATIGUE_MAX);
      }
      if (S.phaseFatigueBeats > 75) {
        const e5MaxEscalation = 1.5 + S.e18ScaleEma; // 1.5x stressed -> 2.5x healthy (ramped)
        const fatigueEscalation = clamp(1.0 + (S.phaseFatigueBeats - 75) / 200, 1.0, e5MaxEscalation);
        ST.rateMultipliers.phaseExemption = m.max(
          ST.rateMultipliers.phaseExemption, fatigueEscalation);
      }
    } else {
      S.phaseFatigueBeats = m.max(0, S.phaseFatigueBeats - ST.ORCHESTRATE_INTERVAL * 0.5);
    }


    // E6: Coherent dwell suppression via pair ceiling tightening
    const currentRegime = state.profiler ? state.profiler.regime : '';
    if (currentRegime === 'coherent') {
      S.coherentRegimeBeats += ST.ORCHESTRATE_INTERVAL;
      // Dynamic threshold: stressed systems (unhealthy) tolerate longer coherent
      // dwells before tightening (threshold rises toward 70). Healthy systems
      // tighten sooner (threshold stays at 30). Prevents aggressive tightening
      // from compounding instability during recovery.
      const dwellThreshold = 30 + (1.0 - S.healthEma) * 40;
      if (S.coherentRegimeBeats > dwellThreshold) {
        const dwellExcess = S.coherentRegimeBeats - dwellThreshold;
        const tightenAmount = clamp(dwellExcess / 75, 0, 0.4);
        ST.rateMultipliers.e6CoherentTightening = clamp(1.0 - tightenAmount, 0.60, 1.0);
      }
    } else {
      S.coherentRegimeBeats = 0;
      ST.rateMultipliers.e6CoherentTightening = 1.0;
    }

    // E13 feedback-loop break: track long-run coherent share. When coherent has
    // been dominant over many beats (shareEma > 0.38), ease E13's coherent ceiling
    // toward the evolving level (0.70) to avoid locking the system into a positive
    // feedback loop (more coherent -> more sparse suppression -> less evolving ->
    // more coherent). Interpolates: at 0.38 share = full 0.55 ceiling; at 0.55+
    // share = relaxed 0.70 ceiling. Attenuation-only on the suppression depth.
    {
      const isCoherent = currentRegime === 'coherent' ? 1 : 0;
      S.coherentShareEma += (isCoherent - S.coherentShareEma) * 0.03; // ~33 tick window (~825 beats)
    }

    // E7: Trust axis rebalancing via entropyRegulator boost
    // Audit: 5.0x coefficient amplifying when trust is low, no health gate.
    // Under stress, aggressive trust rebalancing can overshoot. Scale coefficient
    // by e18Scale: 3.5x when healthy (full correction), 2.0x when stressed.
    // R52: Reduced from 5.0x/2.5x -- full-health 5.0x was over-driving trust coupling
    // into flicker-trust exceedance (127 beats, +210% vs baseline) on long runs.
    let trustShare = 0;
    {
      const axisEnergyShare = pipelineCouplingManager.getAxisEnergyShare();
      trustShare = axisEnergyShare && axisEnergyShare.shares && Number.isFinite(axisEnergyShare.shares.trust) ? axisEnergyShare.shares.trust : 0;
    }
    if (trustShare > 0 && trustShare < 0.07) {
      const trustDeficit = 0.07 - trustShare;
      const e7Coefficient = 2.0 + 1.5 * S.e18ScaleEma; // 2.0x stressed -> 3.5x healthy (ramped)
      ST.rateMultipliers.e7TrustBoost = 1.0 + trustDeficit * e7Coefficient;
    } else {
      ST.rateMultipliers.e7TrustBoost = m.max(1.0, (ST.rateMultipliers.e7TrustBoost) * 0.9);
    }


    // E12: Section-level tension floor relaxation. During section resolution
    // phase (sectionProgress > 0.80), gradually lower the tension arch floor
    // to allow genuine inter-section breathing. Separate from E10 (phrase
    // troughs) -- this operates at the section boundary scale.
    // Uses a slow EMA ramp to avoid the coupling discontinuities that
    // killed the E10 arch floor drop attempt. Max drop 0.15 at full resolution.
    {
      const sectionPhase = harmonicContext.getField('sectionPhase');
      let sectionProgress = 0;
      sectionProgress = clamp(/** @type {number} */ (timeStream.compoundProgress("section")), 0, 1);
      const inResolution = sectionPhase === 'resolution' && sectionProgress > 0.80;
      if (inResolution) {
        // Ramp floor drop slowly via EMA -- avoids discontinuity spikes.
        // E18: scale max drop by health (0.5x when unhealthy, 1.0x at nominal).
        // Attenuation only -- cap at 1.0, never amplify above calibrated 0.15 max.
        const targetDrop = clamp((sectionProgress - 0.80) / 0.20 * 0.15 * e18Scale, 0, 0.15);
        ST.rateMultipliers.e12TensionFloorDrop =
          (ST.rateMultipliers.e12TensionFloorDrop) * 0.75 + targetDrop * 0.25;
      } else {
        // Recover slowly (not instantly) to avoid abrupt re-tension on section boundary
        ST.rateMultipliers.e12TensionFloorDrop =
          m.max(0, (ST.rateMultipliers.e12TensionFloorDrop) * 0.85);
      }
    }

    // E18: Health-gated evolution scaling. Scale E9/E11/E13 intervention
    // strength by current system health. Healthy (healthEma > 0.7) = full
    // strength; degraded (healthEma < 0.7) = automatically reduced.
    // Range: 0.5x (very unhealthy) to 1.0x (healthy = full original strength).
    // ATTENUATION ONLY -- never amplifies above 1.0. The 1.2x amplification
    // in earlier versions (R34-R36) raised the exceedance floor from 22->49+
    // by over-breathing during healthy passages (E9 relax 1.6x vs calibrated 1.5x,
    // E11 ceiling 0.46x vs calibrated 0.55x). Self-healing must only reduce
    // interventions when stressed, never strengthen them above calibrated values.
    // Also factor in exceedance trend: high exceedance (> 0.4) reduces further.
    // NOTE: e18Scale computed early (before step 14) in tick() -- passed in here.

    // E19: HyperMeta crossModulation suppression. Multiplier on crossModulation
    // during E11 sparse windows (<1.0 = suppress, 1.0 = neutral).
    // Uses multiplier semantics so getRateMultiplier's 1.0 default is safe.
    // R32 bug: was additive offset stored as 0, but getRateMultiplier returned
    // 1.0 default, causing +1.0 crossMod boost on every note -- note explosion.
    // Now stored as true multiplier: 1.0 neutral, ~0.87x at max suppression.
    // Positive boost REFUTED (R32). Suppression-only, tied to E11 windows.
    {
      const e11Active = (ST.rateMultipliers.e11SparseWindow) > 0;
      const e11Ceiling = ST.rateMultipliers.e11DensityCeilingOverride;
      if (e11Active && e11Ceiling < 0.95) {
        // Suppress: proportional to ceiling depth, max 13% suppression (0.87x)
        const suppressDepth = clamp((1.0 - e11Ceiling) * 0.28, 0, 0.13);
        const e19Target = 1.0 - suppressDepth;
        // Exponential ramp toward target (alpha 0.25 ~= 4 tick time constant)
        ST.rateMultipliers.e19CrossModScale = (ST.rateMultipliers.e19CrossModScale) +
          (e19Target - (ST.rateMultipliers.e19CrossModScale)) * 0.25;
      } else {
        // Ramp back toward 1.0 (neutral) -- same alpha, symmetric recovery
        ST.rateMultipliers.e19CrossModScale = (ST.rateMultipliers.e19CrossModScale) +
          (1.0 - (ST.rateMultipliers.e19CrossModScale)) * 0.25;
      }
    }

    // E20: MicroUnit attenuator score bias. During E11 sparse windows, lower
    // the crossModulation score used to rank note pairs in the voice cap.
    // Lower scores = more aggressive pruning when voice cap is under pressure.
    // Works in concert with E19 (gate) and E11 (ceiling): triple-layer sparse.
    // Suppression-only: boost direction refuted with E19 (R32 note explosion).
    // Bounded: 0.75 minimum (never more than 25% score reduction).
    {
      const e11Active = (ST.rateMultipliers.e11SparseWindow) > 0;
      const e11Ceiling = ST.rateMultipliers.e11DensityCeilingOverride;
      if (e11Active && e11Ceiling < 0.95) {
        // Score suppression: proportional to ceiling suppression, capped at 0.25
        const biasSuppression = clamp((1.0 - e11Ceiling) * 0.55, 0, 0.25);
        const e20Target = 1.0 - biasSuppression;
        // Exponential ramp toward target (alpha 0.25 -- same as E19)
        ST.rateMultipliers.e20AttenuatorBias = (ST.rateMultipliers.e20AttenuatorBias) +
          (e20Target - (ST.rateMultipliers.e20AttenuatorBias)) * 0.25;
      } else {
        // Ramp back toward 1.0 (neutral)
        ST.rateMultipliers.e20AttenuatorBias = (ST.rateMultipliers.e20AttenuatorBias) +
          (1.0 - (ST.rateMultipliers.e20AttenuatorBias)) * 0.25;
      }
    }

    // E21: Flicker amplitude suppression under exceedance. REFUTED approach
    // was smoothing alpha reduction (R35: caused note explosion via variance
    // floor pathway -- more damped flicker triggered FLICKER_VARIANCE_INJECT
    // additions, elevating density continuously). New approach: suppress the
    // flickerHotspotTrim multiplier directly via a global flicker gain cap.
    // When exceedance is elevated, reduce the maximum flicker amplitude
    // by scaling down the trim ceiling. Neutral (1.0) when healthy.
    // Max suppression: 0.80x flicker amplitude at high exceedance.
    // Proportional: quadratic onset so minor exceedance (0.30-0.50) barely
    // affects flicker; only high sustained exceedance (> 0.70) applies meaningful cap.
    // cap reduction = overage^2 * 2.5, max 0.20 reduction (floor 0.80).
    // Fast EMA blend: normalized to exceedanceTrendEma scale before blending.
    // fastExceedanceEma is energy-based (~0-0.15); threshold 0.05 = density ~0.67
    // or tension ~0.88 (genuine spike). Mapped to [0,1] over 0.05-0.15 range,
    // then weighted 0.35x (early warning only, not dominant signal). R49: 0.6x
    // weight with raw fast EMA caused persistent -29% note suppression because
    // fast EMA sat above slow thresholds (0.20/0.30) at normal energy levels.
    {
      const e21SlowOverage = m.max(0, S.exceedanceTrendEma - 0.30);
      // Rescale fast to slow range: fastExcNormalized is 0-0.35, slow is 0-1.0
      const e21FastRescaled = ST.FAST_EMA_WEIGHT > 0 ? S.fastExcNormalized / ST.FAST_EMA_WEIGHT : 0;
      const e21FastOverage = m.max(0, e21FastRescaled - 0.30);
      const e21ExceedanceOverage = m.max(e21SlowOverage, e21FastOverage);
      ST.rateMultipliers.e21FlickerAmplitudeCap = clamp(1.0 - e21ExceedanceOverage * e21ExceedanceOverage * 2.5, 0.80, 1.0);
    }

    // E23: Rest probability scaling under exceedance. When system is stressed
    // (exceedance elevated), gently increase rest probability to naturally
    // decompress density. This creates breathing room without conductor
    // ceiling changes -- a composition-level pressure valve.
    // Multiplier on rest base: 1.0 neutral, up to 1.4x when exceedance high.
    // Proportional correction: quadratic onset so small overages (exceedance 0.2-0.4)
    // produce negligible boost, and only sustained high exceedance (> 0.5) triggers
    // meaningful rest pressure. Prevents continuous mild suppression during normal
    // stochastic variance that sits just above the 0.2 threshold.
    // boost = overage^2 * 5.0, max 0.4 added (cap at 1.4x).
    // Fast EMA blend: same normalization as E21. fastNorm mapped to [0,1] over
    // energy range 0.05-0.15, weighted 0.35x before comparing to slow threshold.
    {
      const e23SlowOverage = m.max(0, S.exceedanceTrendEma - 0.2);
      const e23FastRescaled = ST.FAST_EMA_WEIGHT > 0 ? S.fastExcNormalized / ST.FAST_EMA_WEIGHT : 0;
      const e23FastOverage = m.max(0, e23FastRescaled - 0.2);
      const e23ExceedanceOverage = m.max(e23SlowOverage, e23FastOverage);
      ST.rateMultipliers.e23RestPressureBoost = clamp(1.0 + e23ExceedanceOverage * e23ExceedanceOverage * 5.0, 1.0, 1.4);
    }

    // REFUTED R15: E15 continuous sculpting -> coherent 47.5%, exceedance 90+ (non-stationary signal)
    // E9: Density breathing windows. At phrase boundaries, temporarily
    // reduce density smoothing and widen the density floor/ceiling gap,
    // letting the raw target signal through with less EMA filtering.
    // This creates structural breathing room at phrase transitions.
    // Acts on conductor config pathway, not on pair ceilings (avoids E6).
    // E18: strength scaled by e18Scale (health * exceedance-awareness).
    {
      let phraseIdx = -1;
      phraseIdx = /** @type {number} */ (timeStream.getPosition('phrase'));
      if (phraseIdx >= 0 && phraseIdx !== S.e9LastPhraseIndex) {
        S.e9LastPhraseIndex = phraseIdx;
        S.e9BreathingCountdown = m.max(2, m.min(6, m.round(layerNumerator * 0.5)));
      }
      if (S.e9BreathingCountdown > 0) {
        // Smoothing relax: 1.0 = normal, >1.0 = reduce smoothing coefficient
        // downstream: effective smoothing = base / e9DensitySmoothingRelax
        // E18: health+exceedance-scaled so stressed system gets less relax
        ST.rateMultipliers.e9DensitySmoothingRelax = 1.0 + 0.5 * e18Scale;
        // Swing boost: widen density bounds temporarily
        ST.rateMultipliers.e9DensitySwingBoost = 1.0 + 0.2 * e18Scale;
        S.e9BreathingCountdown--;
      } else {
        // Decay toward neutral
        ST.rateMultipliers.e9DensitySmoothingRelax = m.max(1.0,
          (ST.rateMultipliers.e9DensitySmoothingRelax) * 0.85);
        ST.rateMultipliers.e9DensitySwingBoost = m.max(1.0,
          (ST.rateMultipliers.e9DensitySwingBoost) * 0.90);
      }
    }

    // E10: Tension release cycle. Break the flat-density -> tension-boost
    // feedback loop. When density is flat and we are at a phrase trough,
    // suppress the tension bias, allowing genuine tension dips.
    // Acts on tension bias pathway, not ceilings.
    // NOTE: arch floor drop removed after R2 showed tension-flicker
    // exceedance -- abrupt floor changes create coupling discontinuities.
    // Only the tension bias suppression remains (gentler pathway).
    {
      let phraseProgress = 0;
      phraseProgress = clamp(/** @type {number} */ (timeStream.compoundProgress("phrase")), 0, 1);
      // Phrase troughs: second half of phrase is the natural descent
      const inPhraseTrough = phraseProgress > 0.55;
      // Check if density is flat via wave analyzer
      const densityWaveFlat = (() => {
        const wp = densityWaveAnalyzer.getWaveProfile();
        return wp && wp.isFlat;
      })();
      if (inPhraseTrough && densityWaveFlat) {
        S.e10ReleaseCooldown = m.max(2, m.min(5, m.round(layerNumerator * 0.4)));
        // Tension suppression: < 1.0 tells densityWaveAnalyzer to suppress
        // its tension boost instead of amplifying.
        // E18: suppression depth health-scaled. 0.7 base at neutral health.
        // Unhealthy (scale 0.5): suppress less (0.85) -- tension stays higher
        // which keeps system stable. Healthy (scale 1.0): full calibrated 0.70.
        // Attenuation only -- cap at 1.0, never suppress more than calibrated 0.70.
        ST.rateMultipliers.e10TensionSuppress = clamp(1.0 - 0.3 * e18Scale, 0.70, 0.85);
      } else if (S.e10ReleaseCooldown > 0) {
        S.e10ReleaseCooldown--;
      } else {
        ST.rateMultipliers.e10TensionSuppress = m.min(1.0,
          (ST.rateMultipliers.e10TensionSuppress) * 1.15);
      }
      ST.rateMultipliers.e10ArchFloorDrop = 0;
    }

    // E11: Structural sparse windows. At phrase boundaries, emit a sparse
    // window signal that forces multi-beat low-density passages. This
    // creates perceptible breathing that single-beat rests cannot achieve.
    // Acts on rest sync probability and density ceiling, not pair ceilings.
    // E13: Regime-aware sparse windows. Exploring regime gets NO suppression
    // (chaos lives there). Coherent gets stronger suppression (breathing
    // needed there most). Evolving gets moderate. This recovers exploring
    // share lost in E11 while concentrating breathing in coherent passages.
    {
      let phraseIdx = -1;
      phraseIdx = /** @type {number} */ (timeStream.getPosition('phrase'));
      let phraseProgress = 0;
      phraseProgress = clamp(/** @type {number} */ (timeStream.compoundProgress("phrase")), 0, 1);
      // Sparse window at phrase wrap: last 5% of phrase
      const atPhraseEnd = phraseProgress > 0.95;
      // Also at phrase start: first 3% after phrase 0
      const atPhraseStart = phraseProgress < 0.03 && phraseIdx > 0;
      if (atPhraseEnd || atPhraseStart) {
        S.e11SparseCountdown = m.max(1, m.min(4, m.round(layerNumerator * 0.3)));
        ST.rateMultipliers.e11SparseWindow = 1.0;
        // E13: Regime-scaled ceiling suppression and rest boost.
        // exploring = no suppression, coherent = strongest, evolving = moderate.
        // E18: ceiling suppression depth health-scaled (less suppression when stressed).
        // For ceiling: base suppression (1.0 - baseVal) scaled, then re-expressed as override.
        // For rest: boost above 1.0 health-scaled.
        // E13 feedback-loop break: when coherent share is above threshold,
        // ease the coherent ceiling to break the suppress->stagnate cycle.
        // Threshold lowered to 0.15 so it fires in realistic session lengths.
        const e13CoherentCeilingBase = currentRegime === 'coherent'
          ? clamp(0.55 + clamp((S.coherentShareEma - 0.15) / 0.25, 0, 1) * 0.07, 0.55, 0.62)
          : 0.55;
        const e13BaseCeiling = currentRegime === 'exploring' ? 1.0
          : currentRegime === 'coherent' ? e13CoherentCeilingBase
          : 0.70; // evolving
        const e13BaseRest = currentRegime === 'exploring' ? 1.0
          : currentRegime === 'coherent' ? 2.5
          : 1.6; // evolving
        // E18: interpolate ceiling toward 1.0 when unhealthy (less suppression).
        // Attenuation only: e18Scale max 1.0, so ceiling never goes below base.
        // At e18Scale=1.0 (healthy): ceiling = exactly baseCeiling (calibrated).
        // At e18Scale<1.0 (stressed): ceiling eases toward 1.0 (less suppression).
        const e13CeilingScale = e13BaseCeiling < 1.0
          ? clamp(1.0 - (1.0 - e13BaseCeiling) * e18Scale, e13BaseCeiling, 1.0)
          : 1.0;
        // E18: scale rest boost above baseline by combined health+exceedance scale
        const e13RestScale = e13BaseRest > 1.0
          ? 1.0 + (e13BaseRest - 1.0) * e18Scale
          : 1.0;
        ST.rateMultipliers.e11DensityCeilingOverride = e13CeilingScale;
        ST.rateMultipliers.e11RestBoost = e13RestScale;
      } else if (S.e11SparseCountdown > 0) {
        ST.rateMultipliers.e11SparseWindow = 1.0;
        // Decay ceiling override back toward 1.0 over remaining countdown beats
        ST.rateMultipliers.e11DensityCeilingOverride = clamp(
          (ST.rateMultipliers.e11DensityCeilingOverride) + 0.15, 0.55, 1.0);
        ST.rateMultipliers.e11RestBoost = m.max(1.0,
          (ST.rateMultipliers.e11RestBoost) * 0.7);
        S.e11SparseCountdown--;
      } else {
        ST.rateMultipliers.e11SparseWindow = 0;
        ST.rateMultipliers.e11DensityCeilingOverride = 1.0;
        ST.rateMultipliers.e11RestBoost = 1.0;
      }
    }
  }

  return { applyEvolutions };
  },
});
