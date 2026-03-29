/**
 * Manages binaural beat pitch shifts and volume crossfades at beat boundaries.
 * L0 channel 'binaural' / layer 'shared' is the single source of truth.
 * Both L1 and L2 consume from it independently, so they always emit the same
 * shift at the same wall-clock second regardless of which layer initiated.
 * @returns {void}
 */
const V = validator.create('setBinaural');

/** Next absolute seconds at which a new binaural shift should be scheduled */
let nextBinauralShiftSec = 0;

/** Per-layer timeInSeconds of the last shared entry this layer consumed (dedup guard) */
const lastConsumedByLayer = {};


setBinaural = () => {
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(L0, 'L0');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const absoluteSeconds = beatStartTime;

  function emitShiftEvents(shiftSyncSec, shiftFlip, shiftInterval) {
    // Pitch bend glide spread over the full interval between shifts
    const bendSteps = 20;
    const bendStepSec = (shiftInterval - .05) / bendSteps;
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
    // Volume crossfade over 0.3s centered on shift time
    const fadeHalf = rf(.05, .15);
    const fadeStart = shiftSyncSec - fadeHalf;
    const volSteps = 20;
    const volStepSec = (fadeHalf * 2) / volSteps;
    for (let i = volSteps / 2; i <= volSteps; i++) {
      const t = fadeStart + volStepSec * i;
      const frac = i / volSteps;
      const volF2 = shiftFlip ? m.floor(100 * (1 - frac)) : m.floor(100 * frac);
      const volT2 = shiftFlip ? m.floor(100 * frac) : m.floor(100 * (1 - frac));
      const maxVol = rf(.9, 1.2);
      flipBinF2.forEach(ch => { p(c, { timeInSeconds: t, type: 'control_c', vals: [ch, 7, m.round(volF2 * maxVol)] }); });
      flipBinT2.forEach(ch => { p(c, { timeInSeconds: t, type: 'control_c', vals: [ch, 7, m.round(volT2 * maxVol)] }); });
    }
  }

  // -- Schedule a new shared shift if due --
  const shiftDue = firstLoop < 1 || absoluteSeconds >= nextBinauralShiftSec;
  if (shiftDue) {
    const binauralSnap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    let binauralInterval = rf(1,3);
    const binauralRegime = binauralSnap ? binauralSnap.regime : 'exploring';
    const binauralIntervalFactor = binauralRegime === 'exploring' ? rf(.8, .9)
      : binauralRegime === 'coherent' ? rf(1.1, 1.2)
      : rf(.95, 1.05);
    binauralInterval = binauralInterval * binauralIntervalFactor;
    nextBinauralShiftSec = absoluteSeconds + binauralInterval;
    flipBin = !flipBin;
    // Clamp current offset into range before stepping -- instrumentation.js seeds
    // binauralFreqOffset from its own temporary BINAURAL default (0.75-2.25) which
    // runs before conductor/config.js overrides BINAURAL to the real range (e.g. 8-12).
    // Without this clamp, rl() receives currentValue far below minValue, collapses
    // its [newMin, newMax] window to an invalid range, and produces large jumps.
    const biasedMin = binauralRegime === 'coherent' ? BINAURAL.min : binauralRegime === 'exploring' ? BINAURAL.min + 2 : BINAURAL.min + 1;
    const biasedMax = binauralRegime === 'coherent' ? BINAURAL.max - 2 : binauralRegime === 'exploring' ? BINAURAL.max : BINAURAL.max - 1;
    binauralFreqOffset = clamp(binauralFreqOffset, biasedMin, biasedMax);
    binauralFreqOffset = rl(binauralFreqOffset, -.3, .3, biasedMin, biasedMax, 'f');
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    L0.post('binaural', 'shared', absoluteSeconds, { freqOffset: binauralFreqOffset, flip: flipBin, interval: binauralInterval });
  }

  // -- Consume the latest shared shift if not yet consumed by this layer --
  const sharedEntry = L0.getLast('binaural', { layer: 'shared' });
  if (sharedEntry && sharedEntry.timeInSeconds !== lastConsumedByLayer[activeLayer]) {
    lastConsumedByLayer[activeLayer] = sharedEntry.timeInSeconds;
    binauralFreqOffset = V.requireFinite(sharedEntry.freqOffset, 'sharedEntry.freqOffset');
    flipBin = V.assertBoolean(sharedEntry.flip, 'sharedEntry.flip');
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    emitShiftEvents(sharedEntry.timeInSeconds, flipBin, sharedEntry.interval || 2.0);

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
