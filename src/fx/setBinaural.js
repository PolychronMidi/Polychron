/**
 * Manages binaural beat pitch shifts and volume crossfades at beat boundaries
 * @returns {void}
 */
setBinaural = () => {
  if (beatCount===beatsUntilBinauralShift || firstLoop<1 ) {
  beatCount=0; flipBin=!flipBin; allNotesOff(beatStart);
  beatsUntilBinauralShift = ri(numerator, numerator * 2 * bpmRatio3);
  binauralFreqOffset=rl(binauralFreqOffset,-1,1,BINAURAL.min,BINAURAL.max);
  // REMOVED: ANTI-PATTERN - THIS IS ABSURD, AS THEY ARE AVAILABLE GLOBALLY
  // let _bfo = 0;
  // try { _bfo = (typeof binauralFreqOffset !== 'undefined') ? binauralFreqOffset : 0; } catch (e) { _bfo = 0; }
  // _bfo = rl(_bfo, -1, 1, (typeof BINAURAL !== 'undefined' && BINAURAL.min) ? BINAURAL.min : 8, (typeof BINAURAL !== 'undefined' && BINAURAL.max) ? BINAURAL.max : 12);
  // try { binauralFreqOffset = _bfo; } catch (e) { /* swallow */ }
  p(c,...binauralL.map(ch=>({tick:beatStart,type:'pitch_bend_c',vals:[ch,ch===lCH1 || ch===lCH3 || ch===lCH5 ? (flipBin ? binauralMinus : binauralPlus) : (flipBin ? binauralPlus : binauralMinus)]})),
  ...binauralR.map(ch=>({tick:beatStart,type:'pitch_bend_c',vals:[ch,ch===rCH1 || ch===rCH3 || ch===rCH5 ? (flipBin ? binauralPlus : binauralMinus) : (flipBin ? binauralMinus : binauralPlus)]})),
  );
  // flipBin (flip binaural) volume transition
  const startTick=beatStart - tpSec/4; const endTick=beatStart + tpSec/4;
  const steps=10; const tickIncrement=(endTick - startTick) / steps;
  for (let i=steps/2-1; i <= steps; i++) {
    const tick=startTick + (tickIncrement * i);
    const currentVolumeF2=flipBin ? m.floor(100 * (1 - (i / steps))) : m.floor(100 * (i / steps));
    const currentVolumeT2=flipBin ? m.floor(100 * (i / steps)) : m.floor(100 * (1 - (i / steps)));
    const maxVol=rf(.9,1.2);
    flipBinF2.forEach(ch => {
      p(c,{tick:tick,type:'control_c',vals:[ch,7,m.round(currentVolumeF2*maxVol)]});
    });
    flipBinT2.forEach(ch => {
      p(c,{tick:tick,type:'control_c',vals:[ch,7,m.round(currentVolumeT2*maxVol)]});
    });
  }
}
}
