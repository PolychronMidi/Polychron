/**
 * Manages binaural beat pitch shifts and volume crossfades at beat boundaries,
 * synced across layers via AbsoluteTimeWindow using ms-precision timestamps.
 * @returns {void}
 */
V = Validator.create('setBinaural');

/** Millisecond tolerance for treating two layer shifts as the same event */
const BINAURAL_SYNC_WINDOW_MS = 200;

setBinaural = () => {
  V.requireFinite(beatIndex, 'beatIndex');
  V.requireFinite(measureIndex, 'measureIndex');
  V.requireDefined(ConductorState, 'ConductorState');
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(AbsoluteTimeWindow, 'AbsoluteTimeWindow');
  V.requireFinite(beatStartTime, 'beatStartTime');

  const activeLayer = LM.activeLayer || 'L?';
  const absTimeSec = beatStartTime;
  const absTimeMs = beatStartTime * 1000;

  const phraseBoundary = beatIndex === 0 && measureIndex === 0;
  const statePhraseBoundary = (() => {
    const state = ConductorState.getSnapshot();
    V.requireDefined(state, 'ConductorState.getSnapshot()');
    V.requireFinite(state.phrasePosition, 'state.phrasePosition');
    return state.phrasePosition <= 0.001 && beatIndex === 0;
  })();
  const shouldShift = firstLoop < 1 || phraseBoundary || statePhraseBoundary;

  if (shouldShift) {
    beatCount = 0;
    allNotesOff(Math.max(beatStart, 0));

    // Cross-layer sync: check if another layer already shifted within the ms window
    const windowSec = BINAURAL_SYNC_WINDOW_MS / 1000;
    const recentShifts = AbsoluteTimeWindow.getBinaural({
      since: absTimeSec - windowSec,
      windowSeconds: windowSec * 2
    });
    const crossLayerShift = recentShifts.find(
      e => e.layer !== activeLayer && Math.abs(e.timeMs - absTimeMs) <= BINAURAL_SYNC_WINDOW_MS
    );

    if (crossLayerShift) {
      // Sync: adopt the offset and flip state from the other layer's shift
      binauralFreqOffset = crossLayerShift.freqOffset;
      flipBin = crossLayerShift.flip;
    } else {
      // New shift: flip and compute a fresh offset
      flipBin = !flipBin;
      binauralFreqOffset = rl(binauralFreqOffset, -1, 1, BINAURAL.min, BINAURAL.max);
    }

    V.requireFinite(numerator, 'numerator');
    V.requireFinite(measuresPerPhrase, 'measuresPerPhrase');
    beatsUntilBinauralShift = Math.max(1, numerator * measuresPerPhrase);

    // Recompute pitch bend values from updated offset — stale values cause audible detune
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    // Record this shift into ATW for cross-layer coordination (ms precision)
    AbsoluteTimeWindow.recordBinaural(binauralFreqOffset, flipBin, activeLayer, absTimeSec, absTimeMs);

    p(c,
      ...binauralL.map(ch => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === lCH1 || ch === lCH3 || ch === lCH5 ? (flipBin ? binauralMinus : binauralPlus) : (flipBin ? binauralPlus : binauralMinus)] })),
      ...binauralR.map(ch => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === rCH1 || ch === rCH3 || ch === rCH5 ? (flipBin ? binauralPlus : binauralMinus) : (flipBin ? binauralMinus : binauralPlus)] }))
    );

    const startTick = beatStart - tpSec / 20;
    const endTick = beatStart + tpSec / 20;
    const steps = 10;
    const tickIncrement = (endTick - startTick) / steps;
    for (let i = 0; i <= steps; i++) {
      const tick = startTick + (tickIncrement * i);
      const currentVolumeF2 = flipBin ? Math.floor(100 * (1 - (i / steps))) : Math.floor(100 * (i / steps));
      const currentVolumeT2 = flipBin ? Math.floor(100 * (i / steps)) : Math.floor(100 * (1 - (i / steps)));
      const maxVol = rf(.9, 1.2);
      flipBinF2.forEach(ch => {
        p(c, { tick: tick, type: 'control_c', vals: [ch, 7, Math.round(currentVolumeF2 * maxVol)] });
      });
      flipBinT2.forEach(ch => {
        p(c, { tick: tick, type: 'control_c', vals: [ch, 7, Math.round(currentVolumeT2 * maxVol)] });
      });
    }
  }
};
