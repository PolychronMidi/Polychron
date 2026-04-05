// src/crossLayer/melody/emergentMelodicEngine.js
// Synthesizes 6 conductor melodic tracker signals into melodic context, posted to L0 `emergentMelody`.
// Three bias surfaces for downstream consumers:
//   nudgeNoveltyWeight() -- harmonicIntervalGuard interval novelty scaling by freshness
//   getMelodicWeights()  -- stutterVariants 12th signal dimension (melodic context)
//   getContourAscendBias() -- alienArpeggio contour-aware pitch direction
// Mirrors emergentRhythmEngine: per-beat cache, self-calibrating EMAs, L0 post, feedbackRegistry.

emergentMelodicEngine = (() => {
  const V = validator.create('emergentMelodicEngine');
  const FRESHNESS_EMA_ALPHA = 0.07;
  const TESSITURE_EMA_ALPHA = 0.05;
  const PHRASE_POST_MIN_BEATS = 4;

  let cachedBeatIndex = -1;
  let lastContext = null;
  let freshnessEma = 0.5;
  let tessitureEma = 0.3;
  let beatsSincePost = 0;
  let cimScale = 0.5;

  function synthesize() {
    if (beatIndex === cachedBeatIndex && lastContext) return lastContext;
    cachedBeatIndex = beatIndex;

    const contour = safePreBoot.call(() => melodicContourTracker.getContour(), null);
    const dirSig = safePreBoot.call(() => melodicContourTracker.getDirectionalitySignal(), null);
    const freshSig = safePreBoot.call(() => intervalDirectionMemory.getFreshnessSignal(), null);
    const tessPressSig = safePreBoot.call(() => tessituraPressureMonitor.getPressureSignal(), null);
    const thematicSig = safePreBoot.call(() => thematicRecallDetector.getThematicSignal(), null);
    const ambiSig = safePreBoot.call(() => ambitusMigrationTracker.getAmbitusSignal(), null);
    const motionProf = safePreBoot.call(() => counterpointMotionTracker.getMotionProfile(), null);

    const contourShape = contour ? (contour.shape || 'static') : 'static';
    const directionBias = contour ? V.optionalFinite(contour.direction, 0) : 0;
    const intervalFreshness = freshSig ? V.optionalFinite(freshSig.freshness, 1) : 1;
    const intervalSuggestion = freshSig ? (freshSig.suggestion || 'maintain') : 'maintain';
    const tessituraLoad = tessPressSig ? V.optionalFinite(tessPressSig.extremeRatio, 0) : 0;
    const tessituraRegion = tessPressSig ? (tessPressSig.region || 'comfortable') : 'comfortable';
    const thematicStatus = thematicSig ? (thematicSig.thematicStatus || 'fresh') : 'fresh';
    const thematicDensity = thematicStatus === 'strong-recall' ? 1 : thematicStatus === 'echo' ? 0.5 : 0;
    const registerMigrationDir = ambiSig ? (ambiSig.trend || 'stable') : 'stable';
    const counterpoint = motionProf ? (motionProf.dominant || 'insufficient') : 'insufficient';
    const ascendRatio = dirSig ? V.optionalFinite(dirSig.ascendRatio, 0.5) : 0.5;

    freshnessEma += (intervalFreshness - freshnessEma) * FRESHNESS_EMA_ALPHA;
    tessitureEma += (tessituraLoad - tessitureEma) * TESSITURE_EMA_ALPHA;

    const context = {
      contourShape, directionBias, intervalFreshness, intervalSuggestion,
      tessituraLoad, tessituraRegion, thematicDensity, registerMigrationDir,
      counterpoint, ascendRatio, freshnessEma, tessitureEma
    };
    lastContext = context;

    beatsSincePost++;
    const freshnessShock = m.abs(intervalFreshness - freshnessEma) > 0.08;
    if (beatsSincePost >= PHRASE_POST_MIN_BEATS && (freshnessShock || tessituraLoad > 0.6 || thematicDensity > 0)) {
      beatsSincePost = 0;
      if (Number.isFinite(beatStartTime)) {
        const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
        L0.post('emergentMelody', layer, beatStartTime, {
          contourShape, directionBias, intervalFreshness, tessituraLoad,
          thematicDensity, counterpoint, freshnessEma
        });
      }
    }

    return context;
  }

  // Scale harmonicIntervalGuard noveltyWeight by interval freshness.
  // Stale territory (low freshness vs EMA) amplifies novelty hunting.
  function nudgeNoveltyWeight(baseWeight) {
    V.requireFinite(baseWeight, 'baseWeight');
    if (baseWeight < 0.005) return baseWeight;
    const ctx = synthesize();
    if (!ctx) return baseWeight;
    const freshnessShock = clamp(1 - ctx.intervalFreshness / m.max(0.1, ctx.freshnessEma), -0.5, 0.5);
    const cimBoost = 1.0 + cimScale * 0.3;
    return clamp(baseWeight * (1.0 + freshnessShock * 0.4) * cimBoost, 0, 1);
  }

  // Contour-modulated ascendBias for alienArpeggio.
  function getContourAscendBias(baseAscendBias) {
    V.requireFinite(baseAscendBias, 'baseAscendBias');
    const ctx = synthesize();
    if (!ctx) return baseAscendBias;
    if (ctx.contourShape === 'rising')  return clamp(baseAscendBias * 1.22, 0.2, 0.85);
    if (ctx.contourShape === 'falling') return clamp(baseAscendBias * 0.72, 0.2, 0.85);
    if (ctx.contourShape === 'arching') return clamp(baseAscendBias + ctx.directionBias * 0.12, 0.2, 0.85);
    return baseAscendBias;
  }

  // Melodic context weight multipliers for stutterVariants (12th signal dimension).
  function getMelodicWeights() {
    const ctx = synthesize();
    if (!ctx) return {};
    const w = {};
    // Stale intervals -> explore harmonic space
    if (ctx.intervalFreshness < 0.4) {
      w.alienArpeggio = 1.5; w.harmonicShadow = 1.3; w.echoTrail = 0.85;
    }
    // Rising contour -> ascend-biased variants
    if (ctx.contourShape === 'rising') {
      w.octaveCascade = 1.3; w.reverseVelocity = 1.2;
    }
    // Contrary counterpoint -> independence-affirming variants
    if (ctx.counterpoint === 'contrary') {
      w.directionalOscillation = 1.4; w.stereoScatter = 1.2;
      w.alienArpeggio = (w.alienArpeggio || 1.0) * 1.2;
    }
    // Parallel lockstep -> break with rhythmic disruption
    if (ctx.counterpoint === 'parallel') {
      w.stutterTremolo = 1.3; w.rhythmicGrid = 1.2; w.ghostStutter = 0.8;
    }
    // High tessiture load -> suppress crowded register density
    if (ctx.tessituraLoad > 0.55) {
      w.machineGun  = (w.machineGun  || 1.0) * 0.7;
      w.stutterSwarm = (w.stutterSwarm || 1.0) * 0.65;
      w.ghostStutter = (w.ghostStutter || 1.0) * 1.25;
    }
    // Strong thematic recall -> reinforce imitative character
    if (ctx.thematicDensity > 0.5) {
      w.machineGun = (w.machineGun || 1.0) * 0.8;
      w.alienArpeggio = (w.alienArpeggio || 1.0) * 1.2;
    }
    // Expanding register -> range-exploring variants
    if (ctx.registerMigrationDir === 'expanding') {
      w.octaveCascade = (w.octaveCascade || 1.0) * 1.2;
    }
    return w;
  }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }
  function getContext() { return lastContext; }

  function reset() {
    cachedBeatIndex = -1;
    lastContext = null;
    freshnessEma = 0.5;
    tessitureEma = 0.3;
    beatsSincePost = 0;
    cimScale = 0.5;
  }

  crossLayerRegistry.register('emergentMelodicEngine', { reset }, ['all', 'section']);

  feedbackRegistry.registerLoop(
    'emergentMelodicPort',
    'melodicTrackers_synthesis',
    'variant_selection_melodicContext',
    () => clamp(lastContext ? lastContext.intervalFreshness : 0.5, 0, 1),
    () => (lastContext && lastContext.tessituraLoad > 0.15) ? 1 : 0
  );

  return { synthesize, nudgeNoveltyWeight, getContourAscendBias, getMelodicWeights, getContext, setCoordinationScale, reset };
})();
