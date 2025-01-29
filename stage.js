require('./sheet'); require('./venue'); require('./backstage'); 
require('./rhythm'); require('./time'); require('./composers');

setTuningAndInstruments=()=>{  
  p(c, ...['control_c', 'program_c'].flatMap(type=>[ ...source.map(ch=>({
  type, vals:[ch, ...(ch.toString().startsWith('leftCH') ? (type==='control_c' ? [10, 0] : [primaryInstrument]) : (type==='control_c' ? [10, 127] : [primaryInstrument]))]})),
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH1, ...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH2, ...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));

  p(c, ...['control_c', 'program_c'].flatMap(type=>[ ...bass.map(ch=>({
    type, vals:[ch, ...(ch.toString().startsWith('leftCH') ? (type==='control_c' ? [10, 0] : [bassInstrument]) : (type==='control_c' ? [10, 127] : [bassInstrument2]))]})),
    { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH3, ...(type==='control_c' ? [tuningPitchBend] : [bassInstrument])]}]));
};

drumMap = {
  'snare1': {note: 31, velocityRange: [99, 111]},
  'snare2': {note: 33, velocityRange: [99, 111]},
  'snare3': {note: 124, velocityRange: [77, 88]},
  'snare4': {note: 125, velocityRange: [77, 88]},
  'snare5': {note: 75, velocityRange: [77, 88]},
  'snare6': {note: 85, velocityRange: [77, 88]},
  'snare7': {note: 118, velocityRange: [66, 77]},
  'snare8': {note: 41, velocityRange: [66, 77]},

  'kick1': {note: 12, velocityRange: [111, 127]},
  'kick2': {note: 14, velocityRange: [111, 127]},
  'kick3': {note: 0, velocityRange: [99, 111]},
  'kick4': {note: 2, velocityRange: [99, 111]},
  'kick5': {note: 4, velocityRange: [88, 99]},
  'kick6': {note: 5, velocityRange: [88, 99]},
  'kick7': {note: 6, velocityRange: [88, 99]},

  'cymbal1': {note: 59, velocityRange: [66, 77]},
  'cymbal2': {note: 53, velocityRange: [66, 77]},
  'cymbal3': {note: 80, velocityRange: [66, 77]},
  'cymbal4': {note: 81, velocityRange: [66, 77]},

  'conga1': {note: 60, velocityRange: [66, 77]},
  'conga2': {note: 61, velocityRange: [66, 77]},
  'conga3': {note: 62, velocityRange: [66, 77]},
  'conga4': {note: 63, velocityRange: [66, 77]},
  'conga5': {note: 64, velocityRange: [66, 77]},
  

};
playDrums = (drumNames, beatOffsets = [0]) => {
  const drums = typeof drumNames === 'string' ? drumNames.split(',').map(d => d.trim()) : drumNames;
  const offsets = Array.isArray(beatOffsets) 
    ? beatOffsets 
    : new Array(drums.length).fill(0);
  if (offsets.length < drums.length) {
    offsets.push(...new Array(drums.length - offsets.length).fill(0));
  }
  drums.forEach((drumName, index) => {
    const drum = drumMap[drumName];
    if (drum) {
      let tickOffset = typeof offsets[index] === 'number' ? offsets[index] * ticksPerBeat : offsets[index];
      p(c, {
        tick: beatStart + tickOffset,
        type: 'note_on_c',
        vals: [9, drum.note, ri(...drum.velocityRange)]
      });
    } else {
      console.warn(`Drum type "${drumName}" not recognized.`);
    }
  });
};
drummer = (drumNames, beatOffsets, offsetJitter = .05) => {
  if (drumNames === 'random') {
    // Use keys from drumMap to get all drum names
    const allDrums = Object.keys(drumMap);
    drumNames = [allDrums[Math.floor(Math.random() * allDrums.length)]];
    beatOffsets = [0]; // Default to playing at beat start for random drum
  }

  // Convert drumNames to array if it's not already
  const drums = Array.isArray(drumNames) ? drumNames : drumNames.split(',').map(d => d.trim());
  
  // Convert beatOffsets to array if it's not
  const offsets = Array.isArray(beatOffsets) ? beatOffsets : [beatOffsets];

  // If drums and offsets don't match, adjust offsets
  if (offsets.length < drums.length) {
    offsets.push(...new Array(drums.length - offsets.length).fill(0));
  } else if (offsets.length > drums.length) {
    offsets.length = drums.length; // Truncate offsets if too many
  }

  // Randomize the order of drums and offsets
  const combined = drums.map((drum, index) => ({ drum, offset: offsets[index] }));
  if (rf() < .7) {
    if (rf() < .5) {
      combined.reverse();
    } else {
      return playDrums(combined.map(item => item.drum), combined.map(item => item.offset));
    }
  } else {
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]]; // Swap elements
    }
  }

  // Adjust offsets with jitter
  const adjustedOffsets = combined.map(({ offset }) => {
    if (rf() < .3) {
      return offset;
    } else {
      let adjusted = offset + (Math.random() < 0.5 ? -offsetJitter : offsetJitter);
      // Ensure the offset is within [0, 1) by using modulus
      return adjusted - Math.floor(adjusted); // This effectively gives us the fractional part
    }
  });

  // Call playDrums with randomized and adjusted data
  playDrums(combined.map(item => item.drum), adjustedOffsets);
};

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
  bassVariation=reflectionVariation*2; centerBalance3=rf()<.5?centerBalance2+m.round(bassVariation*.5) : centerBalance2+m.round(bassVariation*-.5);
  p(c, ...['control_c'].flatMap(()=>{ _={ tick:beatStart, type:'control_c' };
return [
    ...source2.map(ch=>({..._,vals:[ch, 10, ch.toString().startsWith('leftCH') ? (flipBinaural ? leftBalance : rightBalance) : ch.toString().startsWith('rightCH') ? (flipBinaural ? rightBalance : leftBalance) : centerBalance]})),
    ...reflection.map(ch=>({..._,vals:[ch, 10, ch.toString().startsWith('leftCH') ? (flipBinaural ? leftBalance+reflectionVariation : rightBalance-reflectionVariation) : ch.toString().startsWith('rightCH') ? (flipBinaural ? rightBalance-reflectionVariation : leftBalance+reflectionVariation) : centerBalance2+m.round((rf(-.5,.5)*reflectionVariation)) ]})),
    ...bass.map(ch=>({..._,vals:[ch, 10, ch.toString().startsWith('leftCH') ? (flipBinaural ? leftBalance+bassVariation : rightBalance-bassVariation) : ch.toString().startsWith('rightCH') ? (flipBinaural ? rightBalance-bassVariation : leftBalance+bassVariation) : centerBalance3+m.round((rf(-.5,.5)*bassVariation)) ]})),
    ...source.map(ch => rlFX(ch, 1, 0, 60, (c) => c === centerCH1, 0, 10)),
    ...source.map(ch => rlFX(ch, 5, 0, 88)),
    ...source.map(ch => rlFX(ch, 11, 64, 127, (c) => c === centerCH1, 115, 127)),
    ...source.map(ch => rlFX(ch, 65, 0, 1)),
    ...source.map(ch => rlFX(ch, 66, 0, 20)),
    ...source.map(ch => rlFX(ch, 67, 0, 64)),
    ...source2.map(ch => rlFX(ch, 91, 0, 33)),
    ...source2.map(ch => rlFX(ch, 93, 0, 33)),
    ...reflection.map(ch => rlFX(ch, 1, 0, 90, (c) => c === centerCH2, 0, 15)),
    ...reflection.map(ch => rlFX(ch, 5, 0, 127)),
    ...reflection.map(ch => rlFX(ch, 11, 77, 111, (c) => c === centerCH2, 66, 99)),
    ...reflection.map(ch => rlFX(ch, 65, 0, 1)),
    ...reflection.map(ch => rlFX(ch, 66, 0, 77)),
    ...reflection.map(ch => rlFX(ch, 67, 0, 32)),
    ...reflection.map(ch => rlFX(ch, 91, 0, 77, (c) => c === centerCH2, 0, 32)),
    ...reflection.map(ch => rlFX(ch, 93, 0, 77, (c) => c === centerCH2, 0, 32)),
    ...bass.map(ch => rlFX(ch, 1, 0, 60, (c) => c === centerCH3, 0, 10)),
    ...bass.map(ch => rlFX(ch, 5, 0, 88)),
    ...bass.map(ch => rlFX(ch, 11, 64, 127, (c) => c === centerCH3, 115, 127)),
    ...bass.map(ch => rlFX(ch, 65, 0, 1)),
    ...bass.map(ch => rlFX(ch, 66, 0, 20)),
    ...bass.map(ch => rlFX(ch, 67, 0, 64)),
    ...bass.map(ch => rlFX(ch, 91, 0, 33)),
    ...bass.map(ch => rlFX(ch, 93, 0, 33)),
  ];  })  );  }
}

crossModulateRhythms=()=>{ crossModulation=0;
  crossModulation += beatRhythm[beatIndex] > 1 ? rf(1.5,3) : m.max(rf(.625,1.25), (1 / numerator) * beatsOff + (1 / numerator) * beatsOn) + 
  divRhythm[divIndex] > 1 ? rf(1,2) : m.max(rf(.5,1), (1 / divsPerBeat) * divsOff + (1 / divsPerBeat) * divsOn ) + 
  subdivRhythm[subdivIndex] > 1 ? rf(.5,1) : m.max(rf(.25,.5), (1 / subdivsPerDiv) * subdivsOff + (1 / subdivsPerDiv) * subdivsOn) + 
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
  if (crossModulation>rf(.8,1)) {subdivsOff=0; subdivsOn++;
  composer.getNotes().forEach(({ note })=>{  
    events=source.map(sourceCH=>{
      CHsToPlay=flipBinaural ? flipBinauralT.includes(sourceCH) : flipBinauralF.includes(sourceCH);
      if (CHsToPlay) { x=[

      {tick:sourceCH===centerCH1 ? on + rv(ticksPerSubdiv*rf(1/9),[-.1,.1],.3) : on + rv(ticksPerSubdiv*rf(1/3),[-.1,.1],.3),type:'note_on_c',vals:[sourceCH,note,sourceCH===centerCH1 ? velocity*rf(.9,1.1) : binauralVelocity*rf(.95,1.03)]},
      {tick:on+sustain*(sourceCH===centerCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,note]}  ];

      // Stutter-Shift: Uses Maps to store channel-unique stutter and octave shift values
      const stutters = new Map(); const shifts = new Map();
      // Source Channels Stutter-Shift
      if (rf()<rv(.33,[.5,1],.3)){
        if (!stutters.has(sourceCH)) stutters.set(sourceCH, m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
        const numStutters = stutters.get(sourceCH);
        const stutterDuration = sustain/numStutters;
        for (let i=0;i<numStutters;i++) {
          const currentTick=on+stutterDuration*i; let stutterNote=note;
          if(rf()<.5){
            if (!shifts.has(sourceCH)) shifts.set(sourceCH, ri(-2,2)*12);
            const octaveShift = shifts.get(sourceCH);
            stutterNote=circularClamp(note+octaveShift,OCTAVE.min,OCTAVE.max);
          }
          x.push({tick:currentTick-stutterDuration*rf(.15),vals:[sourceCH,stutterNote]});
          x.push({tick:currentTick+stutterDuration*rf(.15,.6),type:'note_on_c',vals:[sourceCH,stutterNote,sourceCH===centerCH1?velocity*rf(.3,.7):binauralVelocity*rf(.45,.8)]});
        }
        x.push({tick:on+sustain*rf(.5,1.5),vals:[sourceCH,note]});
      }

      reflectionCH = reflect[sourceCH]; 
      x.push({tick:reflectionCH===centerCH2 ? on+rv(ticksPerSubdiv*rf(.2),[-.01,.1],.5) : on+rv(ticksPerSubdiv*rf(1/3),[-.01,.1],.5),type:'note_on_c',vals:[reflectionCH,note,reflectionCH===centerCH2 ? velocity*rf(.5,.8) : binauralVelocity*rf(.55,.9)]},
      {tick:on+sustain*(reflectionCH===centerCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,note]} );
      // Reflection Channels Stutter-Shift
      if (rf()<.33){
        if (!stutters.has(reflectionCH)) stutters.set(reflectionCH, m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
        const numStutters = stutters.get(reflectionCH);
        const stutterDuration = sustain/numStutters;
        for (let i=0;i<numStutters;i++) {
          const currentTick=on+stutterDuration*i; let stutterNote=note;
          if(rf()<.7){
            if (!shifts.has(reflectionCH)) shifts.set(reflectionCH, ri(-2,2)*12);
            const octaveShift = shifts.get(reflectionCH);
            stutterNote=circularClamp(note+octaveShift,OCTAVE.min,OCTAVE.max);
          }
          x.push({tick:currentTick-stutterDuration*rf(.3),vals:[reflectionCH,stutterNote]});
          x.push({tick:currentTick+stutterDuration*rf(.25,.7),type:'note_on_c',vals:[reflectionCH,stutterNote,reflectionCH===centerCH2?velocity*rf(.25,.65):binauralVelocity*rf(.4,.75)]});
        }
        x.push({tick:on+sustain*rf(.75,2),vals:[reflectionCH,note]});
      }

      if (rf()<.4) {
        bassCH = reflect2[sourceCH]; bassNote = circularClamp(note, 12, 35);
        x.push({tick:bassCH===centerCH3 ? on+rv(ticksPerSubdiv*rf(.1),[-.01,.1],.5) : on+rv(ticksPerSubdiv*rf(1/3),[-.01,.1],.5),type:'note_on_c',vals:[bassCH,bassNote,bassCH===centerCH3 ? velocity*rf(.95,1.15) : binauralVelocity*rf(1.75,2.25)]},
        {tick:on+sustain*(bassCH===centerCH3 ? rf(.7,1.2)*rf(1.5,3) : rv(rf(.65,1.3))*rf(5,7)),vals:[bassCH,bassNote]} );
      // Bass Channels Stutter-Shift
        if (rf()<.7){
          if (!stutters.has(bassCH)) stutters.set(bassCH, m.round(rv(rv(ri(2,5),[2,3],.33),[2,5],.1)));
          const numStutters = stutters.get(bassCH);
          const stutterDuration = sustain/numStutters;
          for (let i=0;i<numStutters;i++) {
            const currentTick=on+stutterDuration*i; let stutterNote=bassNote;
            if(rf()<.7){
              if (!shifts.has(bassCH)) shifts.set(bassCH, ri(-2,2)*12);
              const octaveShift = shifts.get(bassCH);
              stutterNote=circularClamp(bassNote+octaveShift,0,59);
            }
            x.push({tick:currentTick-stutterDuration*rf(.3),vals:[bassCH,stutterNote]});
            x.push({tick:currentTick+stutterDuration*rf(.25,.7),type:'note_on_c',vals:[bassCH,stutterNote,bassCH===centerCH2?velocity*rf(.35,.65):binauralVelocity*rf(.45,.75)]});
          }
          x.push({tick:on+sustain*rf(.75,2),vals:[bassCH,note]});
        }
      }

      return x; } else { return null; }  }).filter(_=>_!==null).flat();
    p(c, ...events);  });  } else { subdivsOff++; subdivsOn=0; }
};
