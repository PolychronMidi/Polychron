// stage.js - Audio processing engine with MIDI event generation and binaural effects.
// minimalist comments, details at: stage.md
require('./sheet'); require('./writer'); require('./venue'); require('./backstage');
require('./rhythm'); require('./time'); require('./composers'); require('./composers/motifs');
require('./fx');

/**
 * Sets program, pitch bend, and volume for all instrument channels
 * @returns {void}
 */
setTuningAndInstruments = () => {
  p(c,...['control_c','program_c'].flatMap(type=>[ ...source.map(ch=>({
  type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [primaryInstrument]) : (type==='control_c' ? [10,127] : [primaryInstrument]))]})),
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH1,...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH2,...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));
  p(c,...['control_c','program_c'].flatMap(type=>[ ...bass.map(ch=>({
    type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [bassInstrument]) : (type==='control_c' ? [10,127] : [bassInstrument2]))]})),
    { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH3,...(type==='control_c' ? [tuningPitchBend] : [bassInstrument])]}]));
  p(c,{type:'control_c', vals:[drumCH, 7, 127]});
}

/**
 * Randomly updates binaural beat instruments and FX on beat shifts
 * @returns {void}
 */
setOtherInstruments = () => {
  if (rf() < .3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) {
p(c,...['control_c'].flatMap(()=>{ const tmp={ tick:beatStart,type:'program_c' };
  return [
    ...reflectionBinaural.map(ch=>({...tmp,vals:[ch,ra(otherInstruments)]})),
    ...bassBinaural.map(ch=>({...tmp,vals:[ch,ra(otherBassInstruments)]})),
    { ...tmp,vals:[drumCH,ra(drumSets)] }
  ];  })  );  }
}

/**
 * Calculates cross-modulation value based on rhythm state across all levels
 * @returns {void}
 */
crossModulateRhythms = () => {
  lastCrossMod=crossModulation; crossModulation=0;
  crossModulation+=beatRhythm[beatIndex] > 0 ? rf(1.5,3) : m.max(rf(.625,1.25),(1 / numerator) * beatsOff + (1 / numerator) * beatsOn) +
  divRhythm[divIndex] > 0 ? rf(1,2) : m.max(rf(.5,1),(1 / divsPerBeat) * divsOff + (1 / divsPerBeat) * divsOn ) +
  subdivRhythm[subdivIndex] > 0 ? rf(.5,1) : m.max(rf(.25,.5),(1 / subdivsPerDiv) * subdivsOff + (1 / subdivsPerDiv) * subdivsOn) +
  (subdivsOn < ri(7,15) ? rf(.1,.3) : rf(-.1)) + (subdivsOff > ri() ? rf(.1,.3) : rf(-.1)) +
  (divsOn < ri(9,15) ? rf(.1,.3) : rf(-.1)) + (divsOff > ri(3,7) ? rf(.1,.3) : rf(-.1)) +
  (beatsOn < ri(3) ? rf(.1,.3) : rf(-.1)) + (beatsOff > ri(3) ? rf(.1,.3) : rf(-.1)) +
  (subdivsOn > ri(7,15) ? rf(-.3,-.5) : rf(.1)) + (subdivsOff < ri() ? rf(-.3,-.5) : rf(.1)) +
  (divsOn > ri(9,15) ? rf(-.2,-.4) : rf(.1)) + (divsOff < ri(3,7) ? rf(-.2,-.4) : rf(.1)) +
  (beatsOn > ri(3) ? rf(-.2,-.3) : rf(.1)) + (beatsOff < ri(3) ? rf(-.1,-.3) : rf(.1)) +
  (subdivsPerMinute > ri(400,600) ? rf(-.4,-.6) : rf(.1)) + (subdivsOn * rf(-.05,-.15)) + (beatRhythm[beatIndex]<1?rf(.4,.5):0) + (divRhythm[divIndex]<1?rf(.3,.4):0) + (subdivRhythm[subdivIndex]<1?rf(.2,.3):0);
}

/**
 * Calculates note timing and sustain parameters for subdiv-based notes
 * @returns {void}
 */
setSubdivNoteParams = () => {
  on=subdivStart+(tpSubdiv*rv(rf(.2),[-.1,.07],.3));
  shortSustain=rv(rf(m.max(tpDiv*.5,tpDiv / subdivsPerDiv),(tpBeat*(.3+rf()*.7))),[.1,.2],.1,[-.05,-.1]);
  longSustain=rv(rf(tpDiv*.8,(tpBeat*(.3+rf()*.7))),[.1,.3],.1,[-.05,-.1]);
  useShort=subdivsPerMinute > ri(400,650);
  sustain=(useShort ? shortSustain : longSustain)*rv(rf(.8,1.3));
  binVel=rv(velocity * rf(.42,.57));
}

/**
 * Generates MIDI note events for source channels (subdiv-based timing)
 * @returns {void}
 */
playSubdivNotes = () => {
  setSubdivNoteParams();
  // crossModulateRhythms();
  // console.log('Cross Modulation:', crossModulation, 'Last:', lastCrossMod);
  // if((crossModulation+lastCrossMod)/rf(1.7,2.3)>rv(rf(1.8,2.8),[-.2,-.3],.05)){
const noteObjects = composer ? composer.getNotes() : [];
const motifNotes = activeMotif ? applyMotifToNotes(noteObjects, activeMotif) : noteObjects;
try {
  const layer = LM.layers[LM.activeLayer];
  if (layer && layer.beatMotifs) {
    const beatLen = (typeof tpBeat !== 'undefined' && Number.isFinite(Number(tpBeat)) && Number(tpBeat) > 0) ? Number(tpBeat) : 1;
    const beatKey = Math.floor(on / beatLen);
    const bucket = Array.isArray(layer.beatMotifs[beatKey]) ? layer.beatMotifs[beatKey] : [];
    const picks = bucket.length ? getScheduledNotes(bucket, on, on + sustain, ri(1, 3)) : [];
    for (let _pi = 0; _pi < picks.length; _pi++) { const s = picks[_pi];
  // Play source channels
  source.filter(sourceCH=>
    flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
  ).map(sourceCH=>{

    p(c,{tick:sourceCH===cCH1 ? on + rv(tpSubdiv*rf(1/9),[-.1,.1],.3) : on + rv(tpSubdiv*rf(1/3),[-.1,.1],.3),type:'on',vals:[sourceCH,s.note,sourceCH===cCH1 ? velocity*rf(.95,1.15) : binVel*rf(.95,1.03)]});
    p(c,{tick:on+sustain*(sourceCH===cCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,s.note]});

  });

  // Play reflection channels
  reflection.filter(reflectionCH=>
    flipBin ? flipBinT.includes(reflectionCH) : flipBinF.includes(reflectionCH)
  ).map(reflectionCH=>{

    p(c,{tick:reflectionCH===cCH2 ? on+rv(tpSubdiv*rf(.2),[-.01,.1],.5) : on+rv(tpSubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[reflectionCH,s.note,reflectionCH===cCH2 ? velocity*rf(.5,.8) : binVel*rf(.55,.9)]});
    p(c,{tick:on+sustain*(reflectionCH===cCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,s.note]});

  });

  // Play bass channels (with probability based on BPM)
  if (rf()<clamp(.35*bpmRatio3,.2,.7)) {
    bass.filter(bassCH=>
      flipBin ? flipBinT.includes(bassCH) : flipBinF.includes(bassCH)
    ).map(bassCH=>{
      const bassNote=modClamp(s.note,12,35);

      p(c,{tick:bassCH===cCH3 ? on+rv(tpSubdiv*rf(.1),[-.01,.1],.5) : on+rv(tpSubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[bassCH,bassNote,bassCH===cCH3 ? velocity*rf(1.15,1.35) : binVel*rf(1.85,2.45)]});
      p(c,{tick:on+sustain*(bassCH===cCH3 ? rf(1.1,3) : rv(rf(.8,3.5))),vals:[bassCH,bassNote]});
    });
  }

  }
  }
} catch (e) { /* swallow — keep scheduling non-fatal */ }
  // Update per-layer tracking via the canonical helper and preserve globals
  // try { trackRhythm('subdiv', LM.layers[LM.activeLayer], true); } catch (e) { console.warn('trackRhythm(subdiv) failed', e); }
  // subdivsOff=0; subdivsOn++;
  // } else {
  //   try { trackRhythm('subdiv', LM.layers[LM.activeLayer], false); } catch (e) { console.warn('trackRhythm(subdiv) failed', e); }
  //   subdivsOff++; subdivsOn=0;
  // }
}

/**
 * Calculates note timing and sustain parameters for subsubdiv-based notes
 * @returns {void}
 */
setSubsubdivNoteParams = () => {
  on=subsubdivStart+(tpSubsubdiv*rv(rf(.2),[-.1,.07],.3));
  shortSustain=rv(rf(m.max(tpDiv*.5,tpDiv / subdivsPerDiv),(tpBeat*(.3+rf()*.7))),[.1,.2],.1,[-.05,-.1]);
  longSustain=rv(rf(tpDiv*.8,(tpBeat*(.3+rf()*.7))),[.1,.3],.1,[-.05,-.1]);
  useShort=subdivsPerMinute > ri(400,650);
  sustain=(useShort ? shortSustain : longSustain)*rv(rf(.8,1.3));
  binVel=rv(velocity * rf(.42,.57));
}

/**
 * Generates MIDI note events with complex stutter/shift effects (subsubdiv-based timing)
 * @returns {void}
 */
playSubsubdivNotes = () => {
  setSubsubdivNoteParams();
  // crossModulateRhythms();
  // if((crossModulation+lastCrossMod)/rf(1.6,2.4)>rv(rf(1.8,2.2),[-.2,-.3],.05)){
  let reflectionCH; let bassCH; let bassNote;
  const noteObjects = composer ? composer.getNotes() : [];
  const motifNotes = activeMotif ? applyMotifToNotes(noteObjects, activeMotif) : noteObjects;
try {
  const layer = LM.layers[LM.activeLayer];
  if (layer && layer.beatMotifs) {
    const beatLen = (typeof tpBeat !== 'undefined' && Number.isFinite(Number(tpBeat)) && Number(tpBeat) > 0) ? Number(tpBeat) : 1;
    const beatKey = Math.floor(on / beatLen);
    const bucket = Array.isArray(layer.beatMotifs[beatKey]) ? layer.beatMotifs[beatKey] : [];
    if (bucket.length) {
      const picks = getScheduledNotes(bucket, on, on + sustain, ri(1, 2));
      for (let _pi = 0; _pi < picks.length; _pi++) {
        const s = picks[_pi]; // use each pick once
      source.filter(sourceCH=>
  flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
  ).map(sourceCH=>{

  p(c,{tick:sourceCH===cCH1 ? on + rv(tpSubsubdiv*rf(1/9),[-.1,.1],.3) : on + rv(tpSubsubdiv*rf(1/3),[-.1,.1],.3),type:'on',vals:[sourceCH,s.note,sourceCH===cCH1 ? velocity*rf(.95,1.15) : binVel*rf(.95,1.03)]});
  p(c,{tick:on+sustain*(sourceCH===cCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,s.note]});

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
      const tick=on + duration * i; let stutterNote=s.note;
      if (rf() < .25) {
        if (!shifts.has(sourceCH)) shifts.set(sourceCH,ri(-3,3)*12);
        const octaveShift=shifts.get(sourceCH);
        stutterNote=modClamp(s.note + octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
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
    p(c,{tick:on + sustain * rf(.5,1.5),vals:[sourceCH,s.note]});
  }
  if (rf()<rv(.07,[.5,1],.2)){ // Source Channels Stutter-Shift #2: Unique per channel.
    if (!stutters.has(sourceCH)) stutters.set(sourceCH,m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
    const numStutters=stutters.get(sourceCH);
    const duration=.25 * ri(1,5) * sustain / numStutters;
    for (let i=0;i<numStutters;i++) {
      const tick=on+duration*i; let stutterNote=s.note;
      if(rf()<.15){
        if (!shifts.has(sourceCH)) shifts.set(sourceCH,ri(-3,3)*12);
        const octaveShift=shifts.get(sourceCH);
        stutterNote=modClamp(s.note+octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
      }
      if(rf()<.6){
      p(c,{tick:tick-duration*rf(.15),vals:[sourceCH,stutterNote]});
      p(c,{tick:tick+duration*rf(.15,.6),type:'on',vals:[sourceCH,stutterNote,sourceCH===cCH1?velocity*rf(.3,.7):binVel*rf(.45,.8)]});
      }
    }
    p(c,{tick:on+sustain*rf(.5,1.5),vals:[sourceCH,s.note]});
  }

  reflectionCH=reflect[sourceCH];
  p(c,{tick:reflectionCH===cCH2 ? on+rv(tpSubsubdiv*rf(.2),[-.01,.1],.5) : on+rv(tpSubsubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[reflectionCH,s.note,reflectionCH===cCH2 ? velocity*rf(.5,.8) : binVel*rf(.55,.9)]});
  p(c,{tick:on+sustain*(reflectionCH===cCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,s.note]});
  if (rf()<.2){ // Reflection Channels Stutter-Shift
    if (!stutters.has(reflectionCH)) stutters.set(reflectionCH,m.round(rv(rv(ri(2,7),[2,5],.33),[2,5],.1)));
    const numStutters=stutters.get(reflectionCH);
    const duration=.25 * ri(1,8) * sustain / numStutters;
    for (let i=0;i<numStutters;i++) {
      const tick=on+duration*i; let stutterNote=s.note;
      if(rf()<.7){
        if (!shifts.has(reflectionCH)) shifts.set(reflectionCH,ri(-3,3)*12);
        const octaveShift=shifts.get(reflectionCH);
        stutterNote=modClamp(s.note+octaveShift,m.max(0,OCTAVE.min*12-1),OCTAVE.max*12-1);
      }
      if(rf()<.5){
      p(c,{tick:tick-duration*rf(.3),vals:[reflectionCH,stutterNote]});
      p(c,{tick:tick+duration*rf(.25,.7),type:'on',vals:[reflectionCH,stutterNote,reflectionCH===cCH2?velocity*rf(.25,.65):binVel*rf(.4,.75)]});
      }
    }
    p(c,{tick:on+sustain*rf(.75,2),vals:[reflectionCH,s.note]});
  }

  if (rf()<clamp(.35*bpmRatio3,.2,.7)) {
    bassCH=reflect2[sourceCH]; bassNote=modClamp(s.note,12,35);
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
      p(c,{tick:on+sustain*rf(.15,.35),vals:[bassCH,s.note]});
    }
  }
  });
}}}
} catch (e) { /* swallow — keep scheduling non-fatal */ }
  // try { trackRhythm('subsubdiv', LM.layers[LM.activeLayer], true); } catch (e) { console.warn('trackRhythm(subsubdiv) failed', e); }
  // subsubdivsOff=0; subsubdivsOn++;
  // } else {
  //   try { trackRhythm('subsubdiv', LM.layers[LM.activeLayer], false); } catch (e) { console.warn('trackRhythm(subsubdiv) failed', e); }
  //   subsubdivsOff++; subsubdivsOn=0;
  // }
}
