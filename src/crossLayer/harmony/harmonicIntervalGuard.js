// src/crossLayer/harmonicIntervalGuard.js - Cross-layer consonance/dissonance steering.
// Tracks which intervals appear simultaneously between layers.
// When intent calls for consonance, nudges cross-layer intervals toward
// perfect/imperfect consonances. When dissonance is desired, steers toward
// tritones, 2nds, and 7ths. Consumes feedbackOscillator.pitchBias (dead-end signal).

harmonicIntervalGuard = (() => {
  const V = validator.create('harmonicIntervalGuard');
  const MAX_HISTORY = 40;

  // Consonance table: interval class - consonance score 0-1
  // 0=unison, 1=m2, 2=M2, 3=m3, 4=M3, 5=P4, 6=tritone, 7=P5, 8=m6, 9=M6, 10=m7, 11=M7
  const CONSONANCE = Object.freeze([1, 0.1, 0.25, 0.6, 0.7, 0.85, 0.05, 0.95, 0.65, 0.7, 0.2, 0.15]);

  let cimScale = 0.5;

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  /** @type {{ midi: number, absoluteSeconds: number, layer: string }[]} */
  const history = [];

  /** @type {number[]} rolling interval class histogram (12 bins, raw counts) */
  const intervalHist = new Array(12).fill(0);
  let histTotal = 0;

  /**
   * Record a cross-layer interval observation.
   * @param {number} midiA
   * @param {number} midiB
   * @param {number} absoluteSeconds
   */
  function recordCrossInterval(midiA, midiB, absoluteSeconds) {
    V.requireFinite(midiA, 'midiA');
    V.requireFinite(midiB, 'midiB');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    const ic = ((midiA - midiB) % 12 + 12) % 12;
    intervalHist[ic]++;
    histTotal++;
    history.push({ midi: midiA, absoluteSeconds, layer: 'cross' });
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
  }

  /**
   * Measure current dissonance level from recent cross-layer intervals (0=consonant, 1=dissonant).
   * @returns {number}
   */
  function getDissonanceLevel() {
    if (histTotal === 0) return 0.5;
    let weightedCons = 0;
    for (let i = 0; i < 12; i++) {
      weightedCons += (intervalHist[i] / histTotal) * CONSONANCE[i];
    }
    return clamp(1 - weightedCons, 0, 1);
  }

  /**
   * Nudge a MIDI note to better fit the desired consonance/dissonance target.
   * Accepts pre-computed pitchBias to avoid re-calling feedbackOscillator.
   * @param {number} midi - original MIDI note
   * @param {string} activeLayer
   * @param {number} absoluteSeconds
   * @param {number} [externalPitchBias=-1] - pre-computed pitch bias from feedbackOscillator
   * @returns {{ midi: number, nudged: boolean, interval: number, otherMidi: number }}
   */
  function nudgePitch(midi, activeLayer, absoluteSeconds, externalPitchBias) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');

    // Get dissonance target from intent
    const intent = sectionIntentCurves.getLastIntent();
    const dissonanceTarget = V.optionalFinite(intent.dissonanceTarget, 0.5);

    // Use pre-computed pitch bias if provided; avoids re-calling feedbackOscillator.applyFeedback
    const pitchBias = (typeof externalPitchBias === 'number' && Number.isFinite(externalPitchBias) && externalPitchBias >= 0)
      ? externalPitchBias
      : -1;

    // Find other layer's most recent note from ATW
    const otherLayer = crossLayerHelpers.getOtherLayer(activeLayer);
    let otherRecentMidi = -1;
    const lastNote = L0.getLast('note', {
      layer: otherLayer,
      since: absoluteSeconds - 1,
      windowSeconds: 1
    });
    if (lastNote) {
      otherRecentMidi = lastNote.midi || lastNote.note || -1;
    }
    // R34: prefer collision-adjusted MIDI if recent (avoid conflicting nudges)
    const collisionEntry = L0.getLast('registerCollision', { layer: otherLayer });
    if (collisionEntry && m.abs(collisionEntry.timeInSeconds - absoluteSeconds) < 0.2) {
      otherRecentMidi = V.optionalFinite(collisionEntry.midi, otherRecentMidi);
    }

    if (otherRecentMidi < 0) return { midi, nudged: false, interval: -1, otherMidi: -1 };

    const currentIC = ((midi - otherRecentMidi) % 12 + 12) % 12;
    const currentConsonance = CONSONANCE[currentIC];

    // Should we nudge? Only if current consonance is far from target
    const desiredConsonance = 1 - dissonanceTarget;
    const error = currentConsonance - desiredConsonance;
    // R51: verticalCollision awareness -- recent collisions tighten deadband
    const vimEntry = L0.getLast('verticalCollision', { layer: 'both' });
    const vimTighten = vimEntry && Number.isFinite(vimEntry.collisionRate) ? vimEntry.collisionRate * 0.08 : 0;
    // Melodic coupling: intervalFreshness widens deadband for novel intervals,
    // tightens it for stale intervals (correct repetitive harmonic patterns harder).
    const melodicCtxHIG = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const hiFreshness = melodicCtxHIG ? V.optionalFinite(melodicCtxHIG.intervalFreshness, 0.5) : 0.5;
    const freshnessBand = (hiFreshness - 0.5) * 0.06; // [-0.03 stale ... +0.03 fresh]
    // R74: emergentRhythm hotspots coupling -- rhythmic burst positions widen deadband (more interval tolerance during dense moments).
    const rhythmEntryHIG = L0.getLast('emergentRhythm', { layer: 'both' });
    const hotspotsScaleHIG = rhythmEntryHIG && Array.isArray(rhythmEntryHIG.hotspots) ? rhythmEntryHIG.hotspots.length / 16 : 0;
    // R75: registerMigrationDir antagonism bridge -- ascending pitch center narrows interval hunting (inverts roleSwap: chaos in dynamics, stability in harmony).
    const registerNarrowHIG = melodicCtxHIG ? (melodicCtxHIG.registerMigrationDir === 'ascending' ? 0.03 : melodicCtxHIG.registerMigrationDir === 'descending' ? -0.025 : 0) : 0;
    // R80 E1: complexity antagonism bridge with climaxEngine -- high rhythmic complexity narrows deadband
    // (tighter harmonic control during complex moments). Counterpart: climaxEngine ACCELERATES climax
    // on same signal (E2). Harmony stabilizes while structural arc intensifies.
    const complexityHIG = rhythmEntryHIG && Number.isFinite(rhythmEntryHIG.complexity) ? rhythmEntryHIG.complexity : 0.5;
    const complexityNarrowHIG = clamp((complexityHIG - 0.5) * 0.06, -0.02, 0.04);
    // R80 E3: phase coupling -- locked layers prefer consonance (tighter deadband),
    // repelling layers tolerate dissonance (wider deadband for harmonic tension).
    const phaseModeHIG = safePreBoot.call(() => rhythmicPhaseLock.getMode(), 'drift');
    const phaseNarrowHIG = phaseModeHIG === 'lock' ? 0.03 : phaseModeHIG === 'repel' ? -0.04 : 0;
    // R82 E3: tessituraLoad bridge -- extreme register tightens harmonic control (narrow deadband).
    // Counterpart: stutterContagion AMPLIFIES contagion at register extremes (chaos diversifies).
    const tessituraLoadHIG = melodicCtxHIG ? V.optionalFinite(melodicCtxHIG.tessituraLoad, 0) : 0;
    const tessituraNarrowHIG = clamp(tessituraLoadHIG * 0.05, 0, 0.04);
    // R83 E2: ascendRatio bridge -- ascending melodic momentum narrows harmonic deadband
    // (tighter harmonic control during upward energy). Counterpart: velocityInterference
    // AMPLIFIES interference under same signal (dynamics intensify during ascending momentum).
    const ascendRatioHIG = melodicCtxHIG ? V.optionalFinite(melodicCtxHIG.ascendRatio, 0.5) : 0.5;
    const ascendNarrowHIG = clamp((ascendRatioHIG - 0.45) * 0.06, -0.02, 0.04);
    // R85 E3: densitySurprise antagonism bridge -- surprise rhythmic events tighten harmonic control.
    // Counterpart: crossLayerClimaxEngine BACKS OFF climax approach under same signal (form stabilizes while arc defers).
    const densitySurpriseHIG = rhythmEntryHIG && Number.isFinite(rhythmEntryHIG.densitySurprise) ? rhythmEntryHIG.densitySurprise : 0;
    const densitySurpriseNarrowHIG = clamp(densitySurpriseHIG * 0.08, 0, 0.05);
    // R86 E2: complexityEma antagonism bridge -- sustained rhythmic complexity narrows harmonic deadband.
    // Counterpart: velocityInterference AMPLIFIES interference under same signal (dynamics intensify while harmony stabilizes).
    const complexityEmaHIG = rhythmEntryHIG && Number.isFinite(rhythmEntryHIG.complexityEma) ? rhythmEntryHIG.complexityEma : 0.5;
    const complexityEmaNarrowHIG = clamp((complexityEmaHIG - 0.45) * 0.05, -0.02, 0.03);
    // R86 E3: thematicDensity antagonism bridge -- rich thematic development narrows harmonic deadband.
    // Counterpart: crossLayerClimaxEngine ACCELERATES climax approach under same signal (structure intensifies while harmony stabilizes).
    const thematicDensityHIG = melodicCtxHIG ? V.optionalFinite(melodicCtxHIG.thematicDensity, 0) : 0;
    const thematicNarrowHIG = clamp(thematicDensityHIG * 0.06, 0, 0.04);
    // R90 E3: freshnessEma antagonism bridge with phaseAwareCadenceWindow -- sustained melodic novelty
    // narrows harmonic deadband (novel territory = hunt interval variety more aggressively, tighter harmonic control).
    // Counterpart: phaseAwareCadenceWindow COMPRESSES window under same signal (resolution deferred during novelty).
    const freshnessEmaHIG = melodicCtxHIG ? V.optionalFinite(melodicCtxHIG.freshnessEma, 0.5) : 0.5;
    const freshnessEmaNarrowHIG = clamp((freshnessEmaHIG - 0.45) * 0.06, -0.02, 0.03);
    const deadband = clamp(0.18 - clamp(vimTighten, 0, 0.06) + freshnessBand + hotspotsScaleHIG * 0.04 - registerNarrowHIG - complexityNarrowHIG - phaseNarrowHIG - tessituraNarrowHIG - ascendNarrowHIG - densitySurpriseNarrowHIG - complexityEmaNarrowHIG - thematicNarrowHIG - freshnessEmaNarrowHIG, 0.05, 0.30);
    if (m.abs(error) < deadband) return { midi, nudged: false, interval: currentIC, otherMidi: otherRecentMidi };

    // Nudge probability: scale by error magnitude, boosted when dissonance is high
    const nudgeProb = m.abs(error) * (0.6 + dissonanceTarget * 0.3) * (0.4 + cimScale * 1.2);
    if (rf() > nudgeProb) return { midi, nudged: false, interval: currentIC, otherMidi: otherRecentMidi };

    const otherMotifEntry = L0.getLast('motifIdentity', { layer: otherLayer });
    let motifIntervals = null;
    if (otherMotifEntry && otherMotifEntry.intervalDna && otherMotifEntry.confidence > 0.3) {
      motifIntervals = otherMotifEntry.intervalDna.split(',').map(Number).filter(Number.isFinite);
    }

    // Lab R4: widen search radius (3->5) so tritones and 7ths are reachable
    let bestNote = midi;
    let bestScore = Infinity;
    const searchRadius = dissonanceTarget > 0.6 ? 5 : 3;
    const { lo, hi } = crossLayerHelpers.getOctaveBounds({ lowOffset: 0, clipToMidi: true, anchorMidi: midi, radius: searchRadius });
    // R53: interval novelty steering -- under-used ICs get a score bonus when in dissonant+independent mode
    // R54: emergentMelodicEngine amplifies noveltyWeight when interval territory is stale
    const baseNoveltyWeight = histTotal > 12 ? dissonanceTarget * 0.28 * (1.0 - cimScale * 0.65) : 0;
    const noveltyWeight = V.optionalFinite(safePreBoot.call(() => emergentMelodicEngine.nudgeNoveltyWeight(baseNoveltyWeight), baseNoveltyWeight), baseNoveltyWeight);
    // R77 E6: underusedPitchClasses harvest -- bias interval selection toward modally underrepresented pitch classes
    const underusedEntry = L0.getLast('underusedPitchClasses', { layer: 'both' });
    const underusedPCs = underusedEntry && Array.isArray(underusedEntry.pitchClasses) ? underusedEntry.pitchClasses : [];
    for (let candidate = lo; candidate <= hi; candidate++) {
      if (candidate === midi) continue;
      const candidateIC = ((candidate - otherRecentMidi) % 12 + 12) % 12;
      const candidateConsonance = CONSONANCE[candidateIC];
      const score = m.abs(candidateConsonance - desiredConsonance);
      const pitchBiasBonus = (pitchBias >= 0 && (candidate % 12) === pitchBias) ? -0.15 : 0;
      // Motif DNA bonus: prefer candidates whose interval from midi matches one of the other layer's motif intervals
      let motifBonus = 0;
      if (motifIntervals && motifIntervals.length > 0) {
        const candidateInterval = candidate - midi;
        if (motifIntervals.includes(candidateInterval)) motifBonus = -0.12 * otherMotifEntry.confidence;
      }
      // Novelty bonus: rarely-used interval classes score lower (preferred) in exploratory/independent mode
      const noveltyBonus = noveltyWeight > 0.01
        ? -(1 - intervalHist[candidateIC] / histTotal) * noveltyWeight
        : 0;
      // R77 E6: underused pitch class bonus -- prefer candidates that hit modally starved pitch classes
      const underusedBonus = underusedPCs.includes(candidate % 12) ? -0.10 : 0;
      if (score + pitchBiasBonus + motifBonus + noveltyBonus + underusedBonus < bestScore) {
        bestScore = score + pitchBiasBonus + motifBonus + noveltyBonus + underusedBonus;
        bestNote = candidate;
      }
    }

    if (bestNote !== midi) {
      const newIC = ((bestNote - otherRecentMidi) % 12 + 12) % 12;
      recordCrossInterval(bestNote, otherRecentMidi, absoluteSeconds);
      return { midi: bestNote, nudged: true, interval: newIC, otherMidi: otherRecentMidi };
    }

    return { midi, nudged: false, interval: currentIC, otherMidi: otherRecentMidi };
  }

  function reset() {
    history.length = 0;
    intervalHist.fill(0);
    histTotal = 0;
  }

  return { recordCrossInterval, getDissonanceLevel, nudgePitch, setCoordinationScale, reset };
})();
crossLayerRegistry.register('harmonicIntervalGuard', harmonicIntervalGuard, ['all', 'section']);
