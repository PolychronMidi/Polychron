/**
 * Manages binaural beat pitch shifts and volume crossfades at beat boundaries
 * @returns {void}
 */
setBinaural = () => {
  const phraseBoundary = Number.isFinite(Number(beatIndex)) && Number(beatIndex) === 0 && Number.isFinite(Number(measureIndex)) && Number(measureIndex) === 0;
  if (typeof ConductorState === 'undefined' || !ConductorState || typeof ConductorState.getSnapshot !== 'function') {
    throw new Error('setBinaural: ConductorState.getSnapshot is not available — conductor must load before fx');
  }
  const statePhraseBoundary = (() => {
    const state = ConductorState.getSnapshot();
    return state && Number.isFinite(Number(state.phrasePosition)) && Number(state.phrasePosition) <= 0.001 && Number(beatIndex) === 0;
  })();
  const shouldShift = firstLoop < 1 || phraseBoundary || statePhraseBoundary;

  if (shouldShift) {
    beatCount = 0;
    flipBin = !flipBin;
    allNotesOff(beatStart);

    beatsUntilBinauralShift = (Number.isFinite(Number(numerator)) && Number.isFinite(Number(measuresPerPhrase)))
      ? m.max(1, Number(numerator) * Number(measuresPerPhrase))
      : m.max(1, Number(numerator) || 1);

    let targetOffset = Number.isFinite(Number(binauralFreqOffset)) ? Number(binauralFreqOffset) : Number(BINAURAL.min || 0);
    if (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function' && typeof t !== 'undefined' && t && t.Note && typeof t.Note.chroma === 'function') {
      const key = HarmonicContext.getField('key') || 'C';
      const chroma = Number(t.Note.chroma(key));
      if (Number.isFinite(chroma) && chroma >= 0) {
        const minOffset = Number(BINAURAL.min);
        const maxOffset = Number(BINAURAL.max);
        targetOffset = minOffset + (clamp(chroma, 0, 11) / 11) * (maxOffset - minOffset);
      }
    }
    binauralFreqOffset = rl(targetOffset, -0.4, 0.4, BINAURAL.min, BINAURAL.max);

    // Recompute pitch bend values from updated offset — stale values cause audible detune
    if (typeof binauralOffset !== 'function') {
      throw new Error('setBinaural: binauralOffset function is not defined — instrumentation.js must load first');
    }
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    if (!Number.isFinite(binauralPlus) || !Number.isFinite(binauralMinus)) {
      throw new Error(`setBinaural: binauralOffset produced non-finite pitch bends: plus=${binauralPlus}, minus=${binauralMinus}`);
    }

    p(c,
      ...binauralL.map(ch => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === lCH1 || ch === lCH3 || ch === lCH5 ? (flipBin ? binauralMinus : binauralPlus) : (flipBin ? binauralPlus : binauralMinus)] })),
      ...binauralR.map(ch => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === rCH1 || ch === rCH3 || ch === rCH5 ? (flipBin ? binauralPlus : binauralMinus) : (flipBin ? binauralMinus : binauralPlus)] }))
    );

    const startTick = beatStart - tpSec / 4;
    const endTick = beatStart + tpSec / 4;
    const steps = 10;
    const tickIncrement = (endTick - startTick) / steps;
    for (let i = 0; i <= steps; i++) {
      const tick = startTick + (tickIncrement * i);
      const currentVolumeF2 = flipBin ? m.floor(100 * (1 - (i / steps))) : m.floor(100 * (i / steps));
      const currentVolumeT2 = flipBin ? m.floor(100 * (i / steps)) : m.floor(100 * (1 - (i / steps)));
      const maxVol = rf(.9, 1.2);
      flipBinF2.forEach(ch => {
        p(c, { tick: tick, type: 'control_c', vals: [ch, 7, m.round(currentVolumeF2 * maxVol)] });
      });
      flipBinT2.forEach(ch => {
        p(c, { tick: tick, type: 'control_c', vals: [ch, 7, m.round(currentVolumeT2 * maxVol)] });
      });
    }
  }
};
