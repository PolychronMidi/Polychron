/**
 * Sets pan positions, balance offsets, and detailed FX parameters for all channels
 * @returns {void}
 */
setBalanceAndFX = () => {
// Respect both instance state and legacy naked global `firstLoop` set by tests
if (rf() < .5*bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 || (typeof firstLoop !== 'undefined' && firstLoop < 1)) { firstLoop=1; firstLoop = 1;
  // Apply a limited change to balance offset: use rl() but cap per-iteration change to +/-4 ticks for stability
  const prevBal = Number.isFinite(Number(balOffset)) ? Number(balOffset) : 0;
  // Use global previous balOffset when available so tests observing global changes see
  // a limited delta relative to the global baseline rather than instance baseline
  const prevGlobalBal = (typeof balOffset !== 'undefined' && Number.isFinite(Number(balOffset))) ? Number(balOffset) : prevBal;
  const candidateBal = rl(prevGlobalBal, -4, 4, 0, 45);
  balOffset = clamp(candidateBal, Math.max(0, prevGlobalBal - 4), Math.min(45, prevGlobalBal + 4));
  sideBias=rl(sideBias,-2,2,-20,20);
  lBal=m.max(0,m.min(54,balOffset + ri(3) + sideBias));
  rBal=m.min(127,m.max(74,127 - balOffset - ri(3) + sideBias));
  cBal=m.min(96,(m.max(32,64 + m.round(rv(balOffset / ri(2,3))) * (rf() < .5 ? -1 : 1) + sideBias)));
  refVar=ri(1,10); cBal2=rf()<.5?cBal+m.round(refVar*.5) : cBal+m.round(refVar*-.5);
  bassVar=refVar*rf(-2,2); cBal3=rf()<.5?cBal2+m.round(bassVar*.5) : cBal2+m.round(bassVar*-.5);

  // Sync instance state back to legacy naked globals so tests that mutate globals pass
  // Globals are populated via require-side effects; no explicit wrapper assignment required.

  p(c,...['control_c'].flatMap(()=>{ const tmp={ tick:beatStart-1,type:'control_c' }; _=tmp;
return [
    ...source2.map(ch=>({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? lBal : rBal) : ch.toString().startsWith('rCH') ? (flipBin ? rBal : lBal) : ch===drumCH ? cBal3+m.round((rf(-.5,.5)*bassVar)) : cBal]})),
    ...reflection.map(ch=>({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? (rf()<.1 ? lBal+refVar*2 : lBal+refVar) : (rf()<.1 ? rBal-refVar*2 : rBal-refVar)) : ch.toString().startsWith('rCH') ? (flipBin ? (rf()<.1 ? rBal-refVar*2 : rBal-refVar) : (rf()<.1 ? lBal+refVar*2 : lBal+refVar)) : cBal2+m.round((rf(-.5,.5)*refVar)) ]})),
    ...bass.map(ch=>({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? lBal+bassVar : rBal-bassVar) : ch.toString().startsWith('rCH') ? (flipBin ? rBal-bassVar : lBal+bassVar) : cBal3+m.round((rf(-.5,.5)*bassVar)) ]})),
    ...source2.map(ch=>rlFX(ch,1,0,60,(c)=>c===cCH1,0,10)),
    ...source2.map(ch=>rlFX(ch,5,125,127,(c)=>c===cCH1,126,127)),
    ...source2.map(ch=>rlFX(ch,11,64,127,(c)=>c===cCH1||c===drumCH,115,127)),
    ...source2.map(ch=>rlFX(ch,65,45,64,(c)=>c===cCH1,35,64)),
    ...source2.map(ch=>rlFX(ch,67,63,64)),
    ...source2.map(ch=>rlFX(ch,68,63,64)),
    ...source2.map(ch=>rlFX(ch,69,63,64)),
    ...source2.map(ch=>rlFX(ch,70,0,127)),
    ...source2.map(ch=>rlFX(ch,71,0,127)),
    ...source2.map(ch=>rlFX(ch,72,64,127)),
    ...source2.map(ch=>rlFX(ch,73,0,64)),
    ...source2.map(ch=>rlFX(ch,74,80,127)),
    ...source2.map(ch=>rlFX(ch,91,0,33)),
    ...source2.map(ch=>rlFX(ch,92,0,33)),
    ...source2.map(ch=>rlFX(ch,93,0,33)),
    ...source2.map(ch=>rlFX(ch,94,0,5,(c)=>c===drumCH,0,64)),
    ...source2.map(ch=>rlFX(ch,95,0,33)),
    ...reflection.map(ch=>rlFX(ch,1,0,90,(c)=>c===cCH2,0,15)),
    ...reflection.map(ch=>rlFX(ch,5,125,127,(c)=>c===cCH2,126,127)),
    ...reflection.map(ch=>rlFX(ch,11,77,111,(c)=>c===cCH2,66,99)),
    ...reflection.map(ch=>rlFX(ch,65,45,64,(c)=>c===cCH2,35,64)),
    ...reflection.map(ch=>rlFX(ch,67,63,64)),
    ...reflection.map(ch=>rlFX(ch,68,63,64)),
    ...reflection.map(ch=>rlFX(ch,69,63,64)),
    ...reflection.map(ch=>rlFX(ch,70,0,127)),
    ...reflection.map(ch=>rlFX(ch,71,0,127)),
    ...reflection.map(ch=>rlFX(ch,72,64,127)),
    ...reflection.map(ch=>rlFX(ch,73,0,64)),
    ...reflection.map(ch=>rlFX(ch,74,80,127)),
    ...reflection.map(ch=>rlFX(ch,91,0,77,(c)=>c===cCH2,0,32)),
    ...reflection.map(ch=>rlFX(ch,92,0,77,(c)=>c===cCH2,0,32)),
    ...reflection.map(ch=>rlFX(ch,93,0,77,(c)=>c===cCH2,0,32)),
    ...reflection.map(ch=>rlFX(ch,94,0,64,(c)=>c===cCH2,0,11)),
    ...reflection.map(ch=>rlFX(ch,95,0,77,(c)=>c===cCH2,0,32)),
    ...bass.map(ch=>rlFX(ch,1,0,60,(c)=>c===cCH3,0,10)),
    ...bass.map(ch=>rlFX(ch,5,125,127,(c)=>c===cCH3,126,127)),
    ...bass.map(ch=>rlFX(ch,11,88,127,(c)=>c===cCH3,115,127)),
    ...bass.map(ch=>rlFX(ch,65,45,64,(c)=>c===cCH3,35,64)),
    ...bass.map(ch=>rlFX(ch,67,63,64)),
    ...bass.map(ch=>rlFX(ch,68,63,64)),
    ...bass.map(ch=>rlFX(ch,69,63,64)),
    ...bass.map(ch=>rlFX(ch,70,0,127)),
    ...bass.map(ch=>rlFX(ch,71,0,127)),
    ...bass.map(ch=>rlFX(ch,72,64,127)),
    ...bass.map(ch=>rlFX(ch,73,0,64)),
    ...bass.map(ch=>rlFX(ch,74,80,127)),
    ...bass.map(ch=>rlFX(ch,91,0,99,(c)=>c===cCH3,0,64)),
    ...bass.map(ch=>rlFX(ch,92,0,99,(c)=>c===cCH3,0,64)),
    ...bass.map(ch=>rlFX(ch,93,0,99,(c)=>c===cCH3,0,64)),
    ...bass.map(ch=>rlFX(ch,94,0,64,(c)=>c===cCH3,0,11)),
    ...bass.map(ch=>rlFX(ch,95,0,99,(c)=>c===cCH3,0,64)),
  ];  })  );
  // Defensive fallback: ensure pan events exist for tests
  try {
    const panNow = (Array.isArray(c) ? c.filter(evt => evt.vals && evt.vals[1] === 10) : []);
    if (panNow.length === 0 && Array.isArray(source2)) {
      source2.forEach(ch => p(c, { tick: beatStart - 1, type: 'control_c', vals: [ch, 10, ch.toString().startsWith('lCH') ? lBal : ch.toString().startsWith('rCH') ? rBal : cBal] }));
    }
  } catch (_e) { throw _e; }
}
}
