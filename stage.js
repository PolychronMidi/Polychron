require('./sheet'); require('./venue'); require('./backstage'); 
require('./rhythm'); require('./time'); require('./composers');

setTuningAndInstruments=()=>{  
  p(c,...['control_c','program_c'].flatMap(type=>[ ...source.map(ch=>({
  type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [primaryInstrument]) : (type==='control_c' ? [10,127] : [primaryInstrument]))]})),
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH1,...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH2,...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));

  p(c,...['control_c','program_c'].flatMap(type=>[ ...bass.map(ch=>({
    type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [bassInstrument]) : (type==='control_c' ? [10,127] : [bassInstrument2]))]})),
    { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH3,...(type==='control_c' ? [tuningPitchBend] : [bassInstrument])]}]));
  p(c,{type:'control_c', vals:[drumCH, 7, 127]});
};

setOtherInstruments=()=>{
  if (rf() < .3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) {
p(c,...['control_c'].flatMap(()=>{ _={ tick:beatStart,type:'program_c' };
  return [
    ...reflectionBinaural.map(ch=>({..._,vals:[ch,ra(otherInstruments)]})),
    ...bassBinaural.map(ch=>({..._,vals:[ch,ra(otherBassInstruments)]})),
    { ..._,vals:[drumCH,ra(drumSets)] }
  ];  })  );  }
}

setBinaural=()=>{ if (beatCount===beatsUntilBinauralShift || firstLoop<1 ) {
  beatCount=0; flipBin=!flipBin; allNotesOff(beatStart);
  beatsUntilBinauralShift=ri(numerator,numerator*2*bpmRatio3);
  binauralFreqOffset=rl(binauralFreqOffset,-1,1,BINAURAL.min,BINAURAL.max);
  p(c,...binauralL.map(ch=>({tick:beatStart,type:'pitch_bend_c',vals:[ch,ch===lCH1 || ch===lCH3 || ch===lCH5 ? (flipBin ? binauralMinus : binauralPlus) : (flipBin ? binauralPlus : binauralMinus)]})),
  ...binauralR.map(ch=>({tick:beatStart,type:'pitch_bend_c',vals:[ch,ch===rCH1 || ch===rCH3 || ch===rCH5 ? (flipBin ? binauralPlus : binauralMinus) : (flipBin ? binauralMinus : binauralPlus)]})),
  );
  // flipBin volume transition
  const startTick=beatStart - tpSecond/4; const endTick=beatStart + tpSecond/4;
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
};

stutterFade=(channels,numStutters=ri(10,70),duration=tpSecond*rf(.2,1.5))=>{
  const CHsToStutter=ri(1,5); const channelsToStutter=new Set();
  const availableCHs=channels.filter(ch => !lastUsedChannels.has(ch));
  while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
    const ch=availableCHs[m.floor(m.random() * availableCHs.length)];
    channelsToStutter.add(ch);
    availableCHs.splice(availableCHs.indexOf(ch), 1);
  }
  if (channelsToStutter.size < CHsToStutter) {lastUsedChannels.clear();
  } else {lastUsedChannels=new Set(channelsToStutter);
  }
  const channelsArray=Array.from(channelsToStutter);
  channelsArray.forEach(channelToStutter => { const maxVol=ri(90,120);
    const isFadeIn=rf() < 0.5; let tick,volume;
    for (let i=m.floor(numStutters*(rf(1/3,2/3))); i < numStutters; i++) {
      tick=beatStart + i * (duration/numStutters) * rf(.9,1.1);
      if (isFadeIn) {
        volume=modClamp(m.floor(maxVol * (i / (numStutters - 1))),25,maxVol);
      } else {
        volume=modClamp(m.floor(100 * (1 - (i / (numStutters - 1)))),25,100);
      }
      p(c,{tick:tick, type:'control_c', vals:[channelToStutter, 7, m.round(volume/rf(1.5,5))]});
      p(c,{tick:tick + duration*rf(.95,1.95), type:'control_c', vals:[channelToStutter, 7, volume]});
    }
    p(c,{tick:tick + duration*rf(.5,3), type:'control_c', vals:[channelToStutter, 7, maxVol]});
  });
};

stutterPan = (channels, numStutters = ri(30,90), duration = tpSecond*rf(.1,1.2)) => {
  const CHsToStutter = ri(1,2); const channelsToStutter = new Set();
  const availableCHs = channels.filter(ch => !lastUsedChannels2.has(ch));
  while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
    const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
    channelsToStutter.add(ch);
    availableCHs.splice(availableCHs.indexOf(ch), 1);
  }
  if (channelsToStutter.size < CHsToStutter) {lastUsedChannels2.clear();
  } else {lastUsedChannels2 = new Set(channelsToStutter);
  }
  const channelsArray = Array.from(channelsToStutter);
  channelsArray.forEach(channelToStutter => { 
    const edgeMargin = ri(7,25);
    const maxPan = 127-edgeMargin;
    const isFadeIn = rf() < 0.5; 
    let tick, pan;
    for (let i = m.floor(numStutters*(rf(1/3))); i < numStutters; i++) {
      tick = beatStart + i * (duration/numStutters) * rf(.7,1.3);
      if (isFadeIn) {
        pan = modClamp(m.floor(maxPan * (i / (numStutters - 1))),edgeMargin,maxPan);
      } else {
        pan = modClamp(m.floor(maxPan * (1 - (i / (numStutters - 1)))),edgeMargin,maxPan);
      }
      p(c,{tick:tick, type:'control_c', vals:[channelToStutter, 10, modClamp(pan+ri(32,96),0,127)]});
      p(c,{tick:tick + duration*rf(.5,1.75), type:'control_c', vals:[channelToStutter, 10, pan]});
    }
    p(c,{tick:tick + duration*rf(), type:'control_c', vals:[channelToStutter, 10, ri(58,70)]});
  });
};

stutterFX = (channels, numStutters = ri(30,100), duration = tpSecond*rf(.1,2)) => {
  const CHsToStutter = ri(1,2); const channelsToStutter = new Set();
  const availableCHs = channels.filter(ch => !lastUsedChannels3.has(ch));
  while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
    const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
    channelsToStutter.add(ch);
    availableCHs.splice(availableCHs.indexOf(ch), 1);
  }
  if (channelsToStutter.size < CHsToStutter) {lastUsedChannels3.clear();
  } else {lastUsedChannels3 = new Set(channelsToStutter);
  }
  const channelsArray = Array.from(channelsToStutter);
  channelsArray.forEach(channelToStutter => { 
    const FXToStutter=ra(FX);
    const edgeMargin = ri(7,25);
    const max = 127-edgeMargin;
    const isFadeIn = rf() < 0.5; 
    let tick, pan;
    for (let i = m.floor(numStutters*(rf(1/3))); i < numStutters; i++) {
      tick = beatStart + i * (duration/numStutters) * rf(.7,1.3);
      if (isFadeIn) {
        pan = modClamp(m.floor(max * (i / (numStutters - 1))),edgeMargin,max);
      } else {
        pan = modClamp(m.floor(max * (1 - (i / (numStutters - 1)))),edgeMargin,max);
      }
      p(c,{tick:tick, type:'control_c', vals:[channelToStutter, FXToStutter, modClamp(pan+ri(32,96),0,127)]});
      p(c,{tick:tick + duration*rf(.75,1.5), type:'control_c', vals:[channelToStutter, FXToStutter, pan]});
    }
    p(c,{tick:tick + duration*rf(), type:'control_c', vals:[channelToStutter, FXToStutter, ri(58,70)]});
  });
};

setBalanceAndFX=()=>{
if (rf() < .5*bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) { firstLoop=1; 
  balOffset=rl(balOffset,-4,4,0,45);
  sideBias=rl(sideBias,-2,2,-20,20);
  lBal=m.max(0,m.min(54,balOffset + ri(3) + sideBias));
  rBal=m.min(127,m.max(74,127 - balOffset - ri(3) + sideBias));
  cBal=m.min(96,(m.max(32,64 + m.round(rv(balOffset / ri(2,3))) * (rf() < .5 ? -1 : 1) + sideBias)));
  refVar=ri(1,10); cBal2=rf()<.5?cBal+m.round(refVar*.5) : cBal+m.round(refVar*-.5);
  bassVar=refVar*rf(-2,2); cBal3=rf()<.5?cBal2+m.round(bassVar*.5) : cBal2+m.round(bassVar*-.5);
  p(c,...['control_c'].flatMap(()=>{ _={ tick:beatStart-1,type:'control_c' };
return [
    ...source2.map(ch=>({..._,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? lBal : rBal) : ch.toString().startsWith('rCH') ? (flipBin ? rBal : lBal) : ch===drumCH ? cBal3+m.round((rf(-.5,.5)*bassVar)) : cBal]})),
    ...reflection.map(ch=>({..._,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? (rf()<.1 ? lBal+refVar*2 : lBal+refVar) : (rf()<.1 ? rBal-refVar*2 : rBal-refVar)) : ch.toString().startsWith('rCH') ? (flipBin ? (rf()<.1 ? rBal-refVar*2 : rBal-refVar) : (rf()<.1 ? lBal+refVar*2 : lBal+refVar)) : cBal2+m.round((rf(-.5,.5)*refVar)) ]})),
    ...bass.map(ch=>({..._,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? lBal+bassVar : rBal-bassVar) : ch.toString().startsWith('rCH') ? (flipBin ? rBal-bassVar : lBal+bassVar) : cBal3+m.round((rf(-.5,.5)*bassVar)) ]})),
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
  ];  })  );  }
}

crossModulateRhythms=()=>{ crossModulation=0;
  crossModulation+=beatRhythm[beatIndex] > 1 ? rf(1.5,3) : m.max(rf(.625,1.25),(1 / numerator) * beatsOff + (1 / numerator) * beatsOn) + 
  divRhythm[divIndex] > 1 ? rf(1,2) : m.max(rf(.5,1),(1 / divsPerBeat) * divsOff + (1 / divsPerBeat) * divsOn ) + 
  subdivRhythm[subdivIndex] > 1 ? rf(.5,1) : m.max(rf(.25,.5),(1 / subdivsPerDiv) * subdivsOff + (1 / subdivsPerDiv) * subdivsOn) + 
  (subdivsOn < ri(7,15) ? rf(.1,.3) : rf(-.1)) + (subdivsOff > ri() ? rf(.1,.3) : rf(-.1)) + 
  (divsOn < ri(9,15) ? rf(.1,.3) : rf(-.1)) + (divsOff > ri(3,7) ? rf(.1,.3) : rf(-.1)) + 
  (beatsOn < ri(3) ? rf(.1,.3) : rf(-.1)) + (beatsOff > ri(3) ? rf(.1,.3) : rf(-.1)) + 
  (subdivsOn > ri(7,15) ? rf(-.3,-.5) : rf(.1)) + (subdivsOff < ri() ? rf(-.3,-.5) : rf(.1)) + 
  (divsOn > ri(9,15) ? rf(-.2,-.4) : rf(.1)) + (divsOff < ri(3,7) ? rf(-.2,-.4) : rf(.1)) + 
  (beatsOn > ri(3) ? rf(-.2,-.3) : rf(.1)) + (beatsOff < ri(3) ? rf(-.1,-.3) : rf(.1)) + 
  (subdivsPerMinute > ri(400,600) ? rf(-.4,-.6) : rf(.1)) + (subdivsOn * rf(-.05,-.15)) + (beatIndex<1?rf(.4,.5):0) + (divIndex<1?rf(.3,.4):0) + (subdivIndex<1?rf(.2,.3):0);
  console.log('crossModulation:',crossModulation);
};

setNoteParams=()=>{
  on=subdivStart+(tpSubdiv*rv(rf(.2),[-.1,.07],.3));
  shortSustain=rv(rf(m.max(tpDiv*.5,tpDiv / subdivsPerDiv),(tpBeat*(.3+rf()*.7))),[.1,.2],[-.05,-.1],.1);
  longSustain=rv(rf(tpDiv*.8,(tpBeat*(.3+rf()*.7))),[.1,.3],[-.05,-.1],.1);
  useShort=subdivsPerMinute > ri(400,650);
  sustain=(useShort ? shortSustain : longSustain)*rv(rf(.8,1.3));
  binVel=rv(velocity * rf(.42,.57));
}

playNotes=()=>{setNoteParams();crossModulateRhythms();if(crossModulation>rv(rf(1.7,1.95),[-.5,-.3],.05)){ 
composer.getNotes().forEach(({ note })=>{ source.filter(sourceCH=>
  flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
  ).map(sourceCH=>{

  p(c,{tick:sourceCH===cCH1 ? on + rv(tpSubdiv*rf(1/9),[-.1,.1],.3) : on + rv(tpSubdiv*rf(1/3),[-.1,.1],.3),type:'on',vals:[sourceCH,note,sourceCH===cCH1 ? velocity*rf(.95,1.15) : binVel*rf(.95,1.03)]});
  p(c,{tick:on+sustain*(sourceCH===cCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,note]});

  // Stutter-Shift: Random note stutter and octave shift.
  const stutters=new Map(); const shifts=new Map();
  let stutterApplied=false; let globalStutterData=null;
  if (!stutterApplied && rf() < rv(.2,[.5,1],.3)) {
    // Calculate stutter once for all Source channels
    const numStutters=m.round(rv(rv(ri(3,9),[2,5],.33),[2,5],.1));
    globalStutterData={
      numStutters: numStutters,
      duration: .25 * ri(1,6) * sustain / numStutters,
      minVelocity: 11,
      maxVelocity: 111,
      isFadeIn: rf() < 0.5,
      decay: rf(.75,1.25)
    };
    stutterApplied=true;
  }
  if (globalStutterData) {
    const {numStutters,duration,minVelocity,maxVelocity,isFadeIn,decay}=globalStutterData;
    for (let i=0; i < numStutters; i++) {
      const tick=on + duration * i; let stutterNote=note;
      if (rf() < .25) {
        if (!shifts.has(sourceCH)) shifts.set(sourceCH,ri(-3,3)*12);
        const octaveShift=shifts.get(sourceCH);
        stutterNote=modClamp(note + octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
      }
      let currentVelocity;
      if (isFadeIn) {
        const fadeInMultiplier=decay * (i / (numStutters * rf(0.4,2.2) - 1));
        currentVelocity=clamp(m.min(maxVelocity,ri(33) + maxVelocity * fadeInMultiplier),0,100);
      } else {
        const fadeOutMultiplier=1 - (decay * (i / (numStutters * rf(0.4,2.2) - 1)));
        currentVelocity=clamp(m.max(0,ri(33) + maxVelocity * fadeOutMultiplier),0,100);
      }
      p(c,{tick:tick - duration * rf(.15),vals:[sourceCH,stutterNote]});
      p(c,{tick:tick + duration * rf(.15,.6),type:'on',vals:[sourceCH,stutterNote,sourceCH===cCH1 ? currentVelocity * rf(.3,.7) : currentVelocity * rf(.45,.8)]});
    }
    p(c,{tick:on + sustain * rf(.5,1.5),vals:[sourceCH,note]});
  }
  if (rf()<rv(.1,[.5,1],.3)){ // Source Channels Stutter-Shift #2: Unique per channel.
    if (!stutters.has(sourceCH)) stutters.set(sourceCH,m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
    const numStutters=stutters.get(sourceCH);
    const duration=.25 * ri(1,5) * sustain / numStutters;
    for (let i=0;i<numStutters;i++) {
      const tick=on+duration*i; let stutterNote=note;
      if(rf()<.15){
        if (!shifts.has(sourceCH)) shifts.set(sourceCH,ri(-3,3)*12);
        const octaveShift=shifts.get(sourceCH);
        stutterNote=modClamp(note+octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
      }
      p(c,{tick:tick-duration*rf(.15),vals:[sourceCH,stutterNote]});
      p(c,{tick:tick+duration*rf(.15,.6),type:'on',vals:[sourceCH,stutterNote,sourceCH===cCH1?velocity*rf(.3,.7):binVel*rf(.45,.8)]});
    }
    p(c,{tick:on+sustain*rf(.5,1.5),vals:[sourceCH,note]});
  }

  reflectionCH=reflect[sourceCH]; 
  p(c,{tick:reflectionCH===cCH2 ? on+rv(tpSubdiv*rf(.2),[-.01,.1],.5) : on+rv(tpSubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[reflectionCH,note,reflectionCH===cCH2 ? velocity*rf(.5,.8) : binVel*rf(.55,.9)]});
  p(c,{tick:on+sustain*(reflectionCH===cCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,note]});
  if (rf()<.33){ // Reflection Channels Stutter-Shift
    if (!stutters.has(reflectionCH)) stutters.set(reflectionCH,m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
    const numStutters=stutters.get(reflectionCH);
    const duration=.25 * ri(1,8) * sustain / numStutters;
    for (let i=0;i<numStutters;i++) {
      const tick=on+duration*i; let stutterNote=note;
      if(rf()<.7){
        if (!shifts.has(reflectionCH)) shifts.set(reflectionCH,ri(-3,3)*12);
        const octaveShift=shifts.get(reflectionCH);
        stutterNote=modClamp(note+octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
      }
      p(c,{tick:tick-duration*rf(.3),vals:[reflectionCH,stutterNote]});
      p(c,{tick:tick+duration*rf(.25,.7),type:'on',vals:[reflectionCH,stutterNote,reflectionCH===cCH2?velocity*rf(.25,.65):binVel*rf(.4,.75)]});
    }
    p(c,{tick:on+sustain*rf(.75,2),vals:[reflectionCH,note]});
  }

  if (rf()<clamp(.45*bpmRatio3,.2,.7)) {
    bassCH=reflect2[sourceCH]; bassNote=modClamp(note,12,47);
    p(c,{tick:bassCH===cCH3 ? on+rv(tpSubdiv*rf(.1),[-.01,.1],.5) : on+rv(tpSubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[bassCH,bassNote,bassCH===cCH3 ? velocity*rf(1.15,1.35) : binVel*rf(1.85,2.45)]});
    p(c,{tick:on+sustain*(bassCH===cCH3 ? rf(1.1,3) : rv(rf(.8,3.5))),vals:[bassCH,bassNote]});
    if (rf()<.7){ // Bass Channels Stutter-Shift
      if (!stutters.has(bassCH)) stutters.set(bassCH,m.round(rv(rv(ri(2,5),[2,3],.33),[2,10],.1)));
      const numStutters=stutters.get(bassCH);
      const duration=.25 * ri(1,8) * sustain / numStutters;
      for (let i=0;i<numStutters;i++) {
        const tick=on+duration*i; let stutterNote=bassNote;
        if(rf()<.5){
          if (!shifts.has(bassCH)) shifts.set(bassCH,ri(-2,2)*12);
          const octaveShift=shifts.get(bassCH);
          stutterNote=modClamp(bassNote+octaveShift,0,59);
        }
        if(rf()<.5){
        p(c,{tick:tick-duration*rf(.3),vals:[bassCH,stutterNote]});
        p(c,{tick:tick+duration*rf(.25,.7),type:'on',vals:[bassCH,stutterNote,bassCH===cCH3?velocity*rf(.55,.85):binVel*rf(.75,1.05)]});
        }
      }
      p(c,{tick:on+sustain*rf(.15,.35),vals:[bassCH,note]});
    }
  }

  }); }); subdivsOff=0; subdivsOn++; } else { subdivsOff++; subdivsOn=0; }
};


setNoteParams2=()=>{
  on=subsubdivStart+(tpSubsubdiv*rv(rf(.2),[-.1,.07],.3));
  shortSustain=rv(rf(m.max(tpDiv*.5,tpDiv / subdivsPerDiv),(tpBeat*(.3+rf()*.7))),[.1,.2],[-.05,-.1],.1);
  longSustain=rv(rf(tpDiv*.8,(tpBeat*(.3+rf()*.7))),[.1,.3],[-.05,-.1],.1);
  useShort=subdivsPerMinute > ri(400,650);
  sustain=(useShort ? shortSustain : longSustain)*rv(rf(.8,1.3));
  binVel=rv(velocity * rf(.42,.57));
}

playNotes2=()=>{setNoteParams2();crossModulateRhythms();if(crossModulation>rv(rf(1.7,1.9),[-.5,-.3],.1)){ 
composer.getNotes().forEach(({ note })=>{ source.filter(sourceCH=>
  flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
  ).map(sourceCH=>{

  p(c,{tick:sourceCH===cCH1 ? on + rv(tpSubsubdiv*rf(1/9),[-.1,.1],.3) : on + rv(tpSubsubdiv*rf(1/3),[-.1,.1],.3),type:'on',vals:[sourceCH,note,sourceCH===cCH1 ? velocity*rf(.95,1.15) : binVel*rf(.95,1.03)]});
  p(c,{tick:on+sustain*(sourceCH===cCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,note]});

  // Stutter-Shift: Random note stutter and octave shift.
  const stutters=new Map(); const shifts=new Map();
  let stutterApplied=false; let globalStutterData=null;
  if (!stutterApplied && rf() < rv(.2,[.5,1],.3)) {
    // Calculate stutter once for all Source channels
    const numStutters=m.round(rv(rv(ri(3,9),[2,5],.33),[2,5],.1));
    globalStutterData={
      numStutters: numStutters,
      duration: .25 * ri(1,6) * sustain / numStutters,
      minVelocity: 11,
      maxVelocity: 111,
      isFadeIn: rf() < 0.5,
      decay: rf(.75,1.25)
    };
    stutterApplied=true;
  }
  if (globalStutterData) {
    const {numStutters,duration,minVelocity,maxVelocity,isFadeIn,decay}=globalStutterData;
    for (let i=0; i < numStutters; i++) {
      const tick=on + duration * i; let stutterNote=note;
      if (rf() < .25) {
        if (!shifts.has(sourceCH)) shifts.set(sourceCH,ri(-3,3)*12);
        const octaveShift=shifts.get(sourceCH);
        stutterNote=modClamp(note + octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
      }
      let currentVelocity;
      if (isFadeIn) {
        const fadeInMultiplier=decay * (i / (numStutters * rf(0.4,2.2) - 1));
        currentVelocity=clamp(m.min(maxVelocity,ri(33) + maxVelocity * fadeInMultiplier),0,100);
      } else {
        const fadeOutMultiplier=1 - (decay * (i / (numStutters * rf(0.4,2.2) - 1)));
        currentVelocity=clamp(m.max(0,ri(33) + maxVelocity * fadeOutMultiplier),0,100);
      }
      p(c,{tick:tick - duration * rf(.15),vals:[sourceCH,stutterNote]});
      p(c,{tick:tick + duration * rf(.15,.6),type:'on',vals:[sourceCH,stutterNote,sourceCH===cCH1 ? currentVelocity * rf(.3,.7) : currentVelocity * rf(.45,.8)]});
    }
    p(c,{tick:on + sustain * rf(.5,1.5),vals:[sourceCH,note]});
  }
  if (rf()<rv(.07,[.5,1],.2)){ // Source Channels Stutter-Shift #2: Unique per channel.
    if (!stutters.has(sourceCH)) stutters.set(sourceCH,m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
    const numStutters=stutters.get(sourceCH);
    const duration=.25 * ri(1,5) * sustain / numStutters;
    for (let i=0;i<numStutters;i++) {
      const tick=on+duration*i; let stutterNote=note;
      if(rf()<.15){
        if (!shifts.has(sourceCH)) shifts.set(sourceCH,ri(-3,3)*12);
        const octaveShift=shifts.get(sourceCH);
        stutterNote=modClamp(note+octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
      }
      if(rf()<.6){
      p(c,{tick:tick-duration*rf(.15),vals:[sourceCH,stutterNote]});
      p(c,{tick:tick+duration*rf(.15,.6),type:'on',vals:[sourceCH,stutterNote,sourceCH===cCH1?velocity*rf(.3,.7):binVel*rf(.45,.8)]});
      }
    }
    p(c,{tick:on+sustain*rf(.5,1.5),vals:[sourceCH,note]});
  }

  reflectionCH=reflect[sourceCH]; 
  p(c,{tick:reflectionCH===cCH2 ? on+rv(tpSubsubdiv*rf(.2),[-.01,.1],.5) : on+rv(tpSubsubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[reflectionCH,note,reflectionCH===cCH2 ? velocity*rf(.5,.8) : binVel*rf(.55,.9)]});
  p(c,{tick:on+sustain*(reflectionCH===cCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,note]});
  if (rf()<.2){ // Reflection Channels Stutter-Shift
    if (!stutters.has(reflectionCH)) stutters.set(reflectionCH,m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
    const numStutters=stutters.get(reflectionCH);
    const duration=.25 * ri(1,8) * sustain / numStutters;
    for (let i=0;i<numStutters;i++) {
      const tick=on+duration*i; let stutterNote=note;
      if(rf()<.7){
        if (!shifts.has(reflectionCH)) shifts.set(reflectionCH,ri(-3,3)*12);
        const octaveShift=shifts.get(reflectionCH);
        stutterNote=modClamp(note+octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
      }
      if(rf()<.5){
      p(c,{tick:tick-duration*rf(.3),vals:[reflectionCH,stutterNote]});
      p(c,{tick:tick+duration*rf(.25,.7),type:'on',vals:[reflectionCH,stutterNote,reflectionCH===cCH2?velocity*rf(.25,.65):binVel*rf(.4,.75)]});
      }
    }
    p(c,{tick:on+sustain*rf(.75,2),vals:[reflectionCH,note]});
  }

  if (rf()<clamp(.35*bpmRatio3,.2,.7)) {
    bassCH=reflect2[sourceCH]; bassNote=modClamp(note,12,35);
    p(c,{tick:bassCH===cCH3 ? on+rv(tpSubsubdiv*rf(.1),[-.01,.1],.5) : on+rv(tpSubsubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[bassCH,bassNote,bassCH===cCH3 ? velocity*rf(1.15,1.35) : binVel*rf(1.85,2.45)]});
    p(c,{tick:on+sustain*(bassCH===cCH3 ? rf(1.1,3) : rv(rf(.8,3.5))),vals:[bassCH,bassNote]});
    if (rf()<.7){ // Bass Channels Stutter-Shift
      if (!stutters.has(bassCH)) stutters.set(bassCH,m.round(rv(rv(ri(2,5),[2,3],.33),[2,10],.1)));
      const numStutters=stutters.get(bassCH);
      const duration=.25 * ri(1,8) * sustain / numStutters;
      for (let i=0;i<numStutters;i++) {
        const tick=on+duration*i; let stutterNote=bassNote;
        if(rf()<.5){
          if (!shifts.has(bassCH)) shifts.set(bassCH,ri(-2,2)*12);
          const octaveShift=shifts.get(bassCH);
          stutterNote=modClamp(bassNote+octaveShift,0,59);
        }
        if(rf()<.3){
        p(c,{tick:tick-duration*rf(.3),vals:[bassCH,stutterNote]});
        p(c,{tick:tick+duration*rf(.25,.7),type:'on',vals:[bassCH,stutterNote,bassCH===cCH3?velocity*rf(.55,.85):binVel*rf(.75,1.05)]});
        }
      }
      p(c,{tick:on+sustain*rf(.15,.35),vals:[bassCH,note]});
    }
  }

  }); }); }
};
