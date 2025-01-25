require('./sheet'); require('./venue'); require('./backstage'); 
require('./rhythm'); require('./time'); require('./composers');

setTuningAndInstruments=()=>{  
  p(c, ...['control_c', 'program_c'].flatMap(type=>[ ...source.map(ch=>({
  type, vals:[ch, ...(ch.toString().startsWith('leftCH') ? (type==='control_c' ? [10, 0] : [primaryInstrument]) : (type==='control_c' ? [10, 127] : [primaryInstrument]))]})),
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH1, ...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH2, ...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));  
};

setKick=()=> p(c, {tick:beatStart, type:'note_on_c',vals:[9,12,ri(111,127)] });
setKick2=()=> p(c, {tick:beatStart, type:'note_on_c',vals:[9,14,ri(111,127)] });
setSnare=()=> p(c, {tick:beatStart, type:'note_on_c',vals:[9,31,ri(111,127)] });
setSnare2=()=> p(c, {tick:beatStart, type:'note_on_c',vals:[9,33,ri(111,127)] });

setTertiaryInstruments=()=>{
  if (rf() < .3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) {
p(c, ...['control_c'].flatMap(()=>{ _={ tick:beatStart, type:'program_c' };
  return [
    ...reflectionBinaural.map(ch=>({..._,vals:[ch, tertiaryInstruments[ri(tertiaryInstruments.length - 1)]]})),
  ];  })  );  }
}

setBinaural=()=>{
  if (beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) {  beatCount=0; flipBinaural=!flipBinaural;
    beatsUntilBinauralShift=ri(numerator * meterRatio, 7);
    binauralFreqOffset=rl(binauralFreqOffset,-1,1,BINAURAL.min,BINAURAL.max);  }
    allNotesOff(beatStart);
    p(c, ...binauralL.map(ch=>({tick:beatStart, type:'pitch_bend_c', vals:[ch, ch===leftCH1 || ch===leftCH3 ? (flipBinaural ? binauralMinus : binauralPlus) : (flipBinaural ? binauralPlus : binauralMinus)]})), 
    ...binauralR.map(ch=>({tick:beatStart, type:'pitch_bend_c', vals:[ch, ch===rightCH1 || ch===rightCH3 ? (flipBinaural ? binauralPlus : binauralMinus) : (flipBinaural ? binauralMinus : binauralPlus)]})));
};

setBalanceAndFX=()=>{
if (rf() < .5 || beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) { firstLoop=1; 
  balanceOffset=rl(balanceOffset, -4, 4, 0, 45);
  sideBias=rl(sideBias, -2, 2, -20, 20);
  leftBalance=m.max(0,m.min(54, balanceOffset + ri(3) + sideBias));
  rightBalance=m.min(127,m.max(74, 127 - balanceOffset - ri(3) + sideBias));
  centerBalance=m.min(96,(m.max(32, 64 + m.round(rv(balanceOffset / ri(2,3))) * (rf() < .5 ? -1 : 1) + sideBias)));
  reflectionVariation=ri(1,10); centerBalance2=rf()<.5?centerBalance+m.round(reflectionVariation*.5) : centerBalance+m.round(reflectionVariation*-.5);
  p(c, ...['control_c'].flatMap(()=>{ _={ tick:beatStart, type:'control_c' };
return [
    ...source.map(ch=>({..._,vals:[ch, 10, ch.toString().startsWith('leftCH') ? (flipBinaural ? leftBalance : rightBalance) : ch.toString().startsWith('rightCH') ? (flipBinaural ? rightBalance : leftBalance) : centerBalance]})),
    ...reflection.map(ch=>({..._,vals:[ch, 10, ch.toString().startsWith('leftCH') ? (flipBinaural ? leftBalance+reflectionVariation : rightBalance-reflectionVariation) : ch.toString().startsWith('rightCH') ? (flipBinaural ? rightBalance-reflectionVariation : leftBalance+reflectionVariation) : centerBalance2+m.round((rf(-.5,.5)*reflectionVariation)) ]})),
    ...source.map(ch => rlFX(ch, 1, 0, 60, (c) => c === centerCH1, 0, 10)),
    ...source.map(ch => rlFX(ch, 5, 0, 88)),
    ...source.map(ch => rlFX(ch, 11, 64, 127, (c) => c === centerCH1, 115, 127)),
    ...source.map(ch => rlFX(ch, 65, 0, 1)),
    ...source.map(ch => rlFX(ch, 66, 0, 20)),
    ...source.map(ch => rlFX(ch, 67, 0, 64)),
    ...source.map(ch => rlFX(ch, 91, 0, 33)),
    ...source.map(ch => rlFX(ch, 93, 0, 33)),
    ...reflection.map(ch => rlFX(ch, 1, 0, 90, (c) => c === centerCH2, 0, 15)),
    ...reflection.map(ch => rlFX(ch, 5, 0, 127)),
    ...reflection.map(ch => rlFX(ch, 11, 77, 111, (c) => c === centerCH2, 66, 99)),
    ...reflection.map(ch => rlFX(ch, 65, 0, 1)),
    ...reflection.map(ch => rlFX(ch, 66, 0, 77)),
    ...reflection.map(ch => rlFX(ch, 67, 0, 32)),
    ...reflection.map(ch => rlFX(ch, 91, 0, 77, (c) => c === centerCH2, 0, 32)),
    ...reflection.map(ch => rlFX(ch, 93, 0, 77, (c) => c === centerCH2, 0, 32)),
  ];  })  );  }
}

crossModulateRhythms=()=>{ crossModulation=0;
  crossModulation += rf(1.5,(beatRhythm[beatIndex] > rf(-.1) ? 3 : m.min(rf(.75,1.5), 3 / numerator + beatsOff * (1 / numerator)))) + 
  rf(1,(divRhythm[divIndex] > rf(-.1) ? 2 : m.min(rf(.5,1), 2 / divsPerBeat + divsOff * (1 / divsPerBeat)))) + 
  rf(.5,(subdivRhythm[subdivIndex] > rf(-.1) ? 1 : m.min(rf(.25,.5), 1 / subdivsPerDiv + subdivsOff * (1 / subdivsPerDiv)))) + 
  (subdivsOn < ri(7,15) ? rf(.1,.3) : rf(-.1)) + (subdivsOff > ri() ? rf(.1,.3) : rf(-.1)) + 
  (divsOn < ri(9,15) ? rf(.1,.3) : rf(-.1)) + (divsOff > ri(3,7) ? rf(.1,.3) : rf(-.1)) + 
  (beatsOn < ri(3) ? rf(.1,.3) : rf(-.1)) + (beatsOff > ri(3) ? rf(.1,.3) : rf(-.1)) + 
  (subdivsOn > ri(7,15) ? rf(-.3,-.5) : rf(.1)) + (subdivsOff < ri() ? rf(-.3,-.5) : rf(.1)) + 
  (divsOn > ri(9,15) ? rf(-.2,-.4) : rf(.1)) + (divsOff < ri(3,7) ? rf(-.2,-.4) : rf(.1)) + 
  (beatsOn > ri(3) ? rf(-.2,-.3) : rf(.1)) + (beatsOff < ri(3) ? rf(-.1,-.3) : rf(.1)) + 
  (subdivsPerMinute > ri(400,600) ? rf(-.4,-.6) : rf(.1)) + (subdivsOn * rf(-.05,-.15)) + (beatIndex<1?rf(.4,.5):0) + (divIndex<1?rf(.3,.4):0) + (subdivIndex<1?rf(.2,.3):0);
};

setNoteParams=()=>{
  on=subdivStart + rv(ticksPerSubdiv * rf(1/3), [-.01, .07], .3);
  shorterSustain=rv(rf(m.max(ticksPerDiv*.5,ticksPerDiv / subdivsPerDiv),(ticksPerBeat*(.3+rf()*.7))),[.1,.2],[-.05,-.1],.1);
  longerSustain=rv(rf(ticksPerDiv*.8,(ticksPerBeat*(.3+rf()*.7))),[.1,.3],[-.05,-.1],.1);
  useShorterSustain=subdivsPerMinute > ri(400,750);
  sustain=(useShorterSustain ? shorterSustain : longerSustain)*rv(rf(.8,1.3));
  binauralVelocity=rv(velocity * rf(.35, .5));
}

playNotes=()=>{ setNoteParams(); crossModulateRhythms()
  if (crossModulation>rf(4.3,5.1)) {subdivsOff=0; subdivsOn++;
  composer.getNotes().forEach(({ note })=>{  
    events=source.map(sourceCH=>{
      CHsToPlay=flipBinaural ? flipBinauralT.includes(sourceCH) : flipBinauralF.includes(sourceCH);
      if (CHsToPlay) {  reflectionCH = reflect[sourceCH];  x=[
      {tick:sourceCH===centerCH1 ? on + rv(ticksPerSubdiv*rf(1/9),[-.1,.1],.3) : on + rv(ticksPerSubdiv*rf(1/3),[-.1,.1],.3),type:'note_on_c',vals:[sourceCH,note,sourceCH===centerCH1 ? velocity*rf(.9,1.1) : binauralVelocity*rf(.95,1.03)]},
      {tick:on+sustain*(sourceCH===centerCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,note]}  ];

      // Use Maps to store channel-unique stutter and octave shift values
      const chStutters = new Map(); const chOctaveShifts = new Map();
      // Source Channels Stutter
      if (rf()<rv(.33,[.5,1],.3)){
        if (!chStutters.has(sourceCH)) chStutters.set(sourceCH, m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
        const numStutters = chStutters.get(sourceCH);
        const stutterDuration = sustain/numStutters;
        for (let i=0;i<numStutters;i++) {
          const currentTick=on+stutterDuration*i; let stutterNote=note;
          if(rf()<.5){
            if (!chOctaveShifts.has(sourceCH)) chOctaveShifts.set(sourceCH, ri(-2,2)*12);
            const octaveShift = chOctaveShifts.get(sourceCH);
            stutterNote=clamp(note+octaveShift,OCTAVE.min,OCTAVE.max);
          }
          x.push({tick:currentTick-stutterDuration*rf(.15),vals:[sourceCH,stutterNote]});
          x.push({tick:currentTick+stutterDuration*rf(.15,.6),type:'note_on_c',vals:[sourceCH,stutterNote,sourceCH===centerCH1?velocity*rf(.3,.7):binauralVelocity*rf(.45,.8)]});
        }
        x.push({tick:on+sustain*rf(.5,1.5),vals:[sourceCH,note]});
      }

      x.push({tick:reflectionCH===centerCH2 ? on+rv(ticksPerSubdiv*rf(.2),[-.01,.1],.5) : on+rv(ticksPerSubdiv*rf(1/3),[-.01,.1],.5),type:'note_on_c',vals:[reflectionCH,note,reflectionCH===centerCH2 ? velocity*rf(.5,.8) : binauralVelocity*rf(.55,.9)]},
      {tick:on+sustain*(reflectionCH===centerCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,note]} );

      // Reflection Channels Stutter
      if (rf()<.33){
        if (!chStutters.has(reflectionCH)) chStutters.set(reflectionCH, m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
        const numStutters = chStutters.get(reflectionCH);
        const stutterDuration = sustain/numStutters;
        for (let i=0;i<numStutters;i++) {
          const currentTick=on+stutterDuration*i; let stutterNote=note;
          if(rf()<.7){
            if (!chOctaveShifts.has(reflectionCH)) chOctaveShifts.set(reflectionCH, ri(-2,2)*12);
            const octaveShift = chOctaveShifts.get(reflectionCH);
            stutterNote=clamp(note+octaveShift,OCTAVE.min,OCTAVE.max);
          }
          x.push({tick:currentTick-stutterDuration*rf(.3),vals:[reflectionCH,stutterNote]});
          x.push({tick:currentTick+stutterDuration*rf(.25,.7),type:'note_on_c',vals:[reflectionCH,stutterNote,reflectionCH===centerCH2?velocity*rf(.25,.65):binauralVelocity*rf(.4,.75)]});
        }
        x.push({tick:on+sustain*rf(.75,2),vals:[reflectionCH,note]});
      }

      return x; } else { return null; }  }).filter(_=>_!==null).flat();
    p(c, ...events);  });  } else { subdivsOff++; subdivsOn=0; }
};
