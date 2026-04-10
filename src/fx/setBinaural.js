/**
 * Manages binaural beat pitch shifts and volume crossfades.
 * L0 channel 'binaural' / layer 'shared' is the single source of truth.
 * Both L1 and L2 consume from it independently, so they always emit the same
 * shift at the same wall-clock second regardless of which layer initiated.
 * @returns {void}
 */

// Binaural should always be SUBPERCEPTUAL as a subtle neurostimulant, NOT as an overt effect. Rapid or large shifts can be jarring and unpleasant. The goal is to create a gentle, evolving soundscape that engages the brain without drawing attention to the binaural effect itself.
const V = validator.create('setBinaural');

/** Next absolute seconds at which a new binaural shift should be scheduled */
let nextBinauralShiftSec = 0;

/** Current flipBin crossfade window [startSec, endSec]. Updated each shift. */
flipBinCrossfadeWindow = [0, 0];

/** Per-layer timeInSeconds of the last shared entry this layer consumed (dedup guard) */
const lastConsumedByLayer = {};
// Per-layer flipBin state lives in LM.perLayerState (restored on activate)

/**
 * Emit pitch bend glides and volume crossfades for a binaural shift.
 * Hoisted so both the scheduling path and the consume path can call it.
 */
function emitShiftEvents(shiftSyncSec, shiftFlip, shiftInterval) {
  void shiftInterval;
  // Pitch bend glide completes within the crossfade window, not over the full
  // interval. After crossfade, channels are at full volume with final pitch bend
  // already applied. No gliding while audible = no detune artifacts.
  const bendDuration = rf(0.01, 0.02);
  const bendSteps = 5;
  const bendStepSec = bendDuration / bendSteps;
  for (let i = 0; i <= bendSteps; i++) {
    const t = shiftSyncSec + bendStepSec * i;
    const frac = i / bendSteps;
    binauralL.forEach(ch => {
      const target = (ch === lCH1 || ch === lCH3 || ch === lCH5) ? (shiftFlip ? binauralMinus : binauralPlus) : (shiftFlip ? binauralPlus : binauralMinus);
      const prev = (ch === lCH1 || ch === lCH3 || ch === lCH5) ? (shiftFlip ? binauralPlus : binauralMinus) : (shiftFlip ? binauralMinus : binauralPlus);
      p(c, { timeInSeconds: t, type: 'pitch_bend_c', vals: [ch, m.round(prev + (target - prev) * frac)] });
    });
    binauralR.forEach(ch => {
      const target = (ch === rCH1 || ch === rCH3 || ch === rCH5) ? (shiftFlip ? binauralPlus : binauralMinus) : (shiftFlip ? binauralMinus : binauralPlus);
      const prev = (ch === rCH1 || ch === rCH3 || ch === rCH5) ? (shiftFlip ? binauralMinus : binauralPlus) : (shiftFlip ? binauralPlus : binauralMinus);
      p(c, { timeInSeconds: t, type: 'pitch_bend_c', vals: [ch, m.round(prev + (target - prev) * frac)] });
    });
  }
  // Volume crossfade covering the FULL window (not just second half).
  // Brief volume dip at exact shift moment masks pitch bend overlap.
  const flipBinCrossfade = bendDuration * 2;
  const fadeStart = shiftSyncSec - flipBinCrossfade / 1.9;
  flipBinCrossfadeWindow = [fadeStart, fadeStart + flipBinCrossfade];
  const volSteps = 9;
  const volStepSec = flipBinCrossfade / volSteps;
  for (let i = 0; i <= volSteps; i++) {
    const t = fadeStart + volStepSec * i;
    const frac = i / volSteps;
    // Outgoing channels: full -> zero over the window
    const volOut = shiftFlip ? m.floor(100 * (1 - frac)) : m.floor(100 * frac);
    // Incoming channels: zero -> full over the window
    const volIn = shiftFlip ? m.floor(100 * frac) : m.floor(100 * (1 - frac));
    // Volume dip at midpoint to mask detune overlap
    const dipScale = 1.0 - 0.25 * m.exp(-m.pow((frac - 0.5) / 0.15, 2));
    const maxVol = rf(.9, 1.2);
    flipBinF2.forEach(ch => { p(c, { timeInSeconds: t, type: 'control_c', vals: [ch, 7, m.round(volOut * maxVol * dipScale)] }); });
    flipBinT2.forEach(ch => { p(c, { timeInSeconds: t, type: 'control_c', vals: [ch, 7, m.round(volIn * maxVol * dipScale)] }); });
  }
  // Restore full volume on both channel sets after crossfade completes
  const restoreTime = fadeStart + flipBinCrossfade + 0.01;
  flipBinF2.forEach(ch => { p(c, { timeInSeconds: restoreTime, type: 'control_c', vals: [ch, 7, 100] }); });
  flipBinT2.forEach(ch => { p(c, { timeInSeconds: restoreTime, type: 'control_c', vals: [ch, 7, 100] }); });
  // Snap all channels to final target pitch bend after crossfade - no residual glide
  const snapTime = restoreTime + 0.005;
  binauralL.forEach(ch => {
    const target = (ch === lCH1 || ch === lCH3 || ch === lCH5) ? (shiftFlip ? binauralMinus : binauralPlus) : (shiftFlip ? binauralPlus : binauralMinus);
    p(c, { timeInSeconds: snapTime, type: 'pitch_bend_c', vals: [ch, target] });
  });
  binauralR.forEach(ch => {
    const target = (ch === rCH1 || ch === rCH3 || ch === rCH5) ? (shiftFlip ? binauralPlus : binauralMinus) : (shiftFlip ? binauralMinus : binauralPlus);
    p(c, { timeInSeconds: snapTime, type: 'pitch_bend_c', vals: [ch, target] });
  });
}

setBinaural = () => {
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(L0, 'L0');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const absoluteSeconds = beatStartTime;

  // -- Schedule a new shared shift if due --
  const shiftDue = firstLoop < 1 || absoluteSeconds >= nextBinauralShiftSec;
  if (shiftDue) {
    const binauralSnap = systemDynamicsProfiler.getSnapshot();
    let binauralInterval = rf(2,3);
    const binauralRegime = binauralSnap ? binauralSnap.regime : 'exploring';
    const binauralIntervalFactor = binauralRegime === 'exploring' ? rf(.8, .9)
      : binauralRegime === 'coherent' ? rf(1.1, 1.2)
      : rf(.95, 1.05);
    binauralInterval = binauralInterval * binauralIntervalFactor;
    nextBinauralShiftSec = absoluteSeconds + binauralInterval;
    const freqChangeRateLimit = binauralInterval / 10;
    // Toggle per-layer to prevent cross-layer desync
    LM.perLayerState[activeLayer].flipBin = !LM.perLayerState[activeLayer].flipBin;
    flipBin = LM.perLayerState[activeLayer].flipBin;
    const phraseCtx = FactoryManager.sharedPhraseArcManager.getPhraseContext();
    const brightness = phraseCtx && Number.isFinite(phraseCtx.spectralDensity) ? phraseCtx.spectralDensity : 0.5;
    // Xenolinguistic: modal color drives binaural frequency. Chromatic = higher beta (alert),
    // diatonic = lower alpha (calm). The brainstem hears harmonic complexity.
    const modalColor = safePreBoot.call(() => modalColorTracker.getModalProfile(), null);
    const colorShift = modalColor ? clamp((modalColor.colorToneRatio - 0.4) * 1.5, -0.5, 0.5) : 0;
    const brightnessBias = clamp((brightness - 0.5) * 1.5 + colorShift, -0.75, 0.75);
    let biasedMin = (binauralRegime === 'coherent' ? BINAURAL.min : binauralRegime === 'exploring' ? BINAURAL.min + 2 : BINAURAL.min + 1) + brightnessBias * 0.5;
    let biasedMax = (binauralRegime === 'coherent' ? BINAURAL.max - 2 : binauralRegime === 'exploring' ? BINAURAL.max : BINAURAL.max - 1) + brightnessBias * 0.5;
    biasedMin = fuzzyClamp(biasedMin, biasedMin-freqChangeRateLimit, biasedMin+freqChangeRateLimit, rf(.1), 'both');
    biasedMax = fuzzyClamp(biasedMax, biasedMax-freqChangeRateLimit, biasedMax+freqChangeRateLimit, rf(.1), 'both');
    binauralFreqOffset = clamp(binauralFreqOffset, biasedMin, biasedMax);
    binauralFreqOffset = rl(binauralFreqOffset, -freqChangeRateLimit, freqChangeRateLimit, biasedMin, biasedMax, 'f');
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    L0.post(L0_CHANNELS.binaural, 'shared', absoluteSeconds, { freqOffset: binauralFreqOffset, flip: flipBin, interval: binauralInterval });
  }

  // -- Consume the latest shared shift if not yet consumed by this layer --
  // CRITICAL: this runs OUTSIDE the shiftDue gate so L2 processes L1's shifts
  // even when L2's own shift isn't due. Prevents detune bleed-through from
  // desynchronized pitch bend state between layers.
  const sharedEntry = L0.getLast(L0_CHANNELS.binaural, { layer: 'shared' });
  if (sharedEntry && sharedEntry.timeInSeconds !== lastConsumedByLayer[activeLayer]) {
    lastConsumedByLayer[activeLayer] = sharedEntry.timeInSeconds;
    binauralFreqOffset = V.requireFinite(sharedEntry.freqOffset, 'sharedEntry.freqOffset');
    // Sync per-layer flipBin from shared entry, set global to this layer's state
    LM.perLayerState[activeLayer].flipBin = V.assertBoolean(sharedEntry.flip, 'sharedEntry.flip');
    flipBin = LM.perLayerState[activeLayer].flipBin;
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    emitShiftEvents(sharedEntry.timeInSeconds, flipBin, V.optionalFinite(sharedEntry.interval, 2.0));

    if (traceDrain && traceDrain.isEnabled()) {
      traceDrain.recordBinauralShift({
        layer: activeLayer,
        absTimeMs: absoluteSeconds * 1000,
        syncMs: sharedEntry.timeInSeconds * 1000,
        usedCrossLayerShift: activeLayer !== 'L1' || !shiftDue,
        syncDeltaMs: m.abs(absoluteSeconds - sharedEntry.timeInSeconds) * 1000,
        freqOffset: binauralFreqOffset,
        toleranceMs: 0,
        flip: flipBin
      });
    }
  }
};
