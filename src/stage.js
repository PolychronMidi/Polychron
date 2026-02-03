// stage.js - Audio processing engine with MIDI event generation.

// Central importation hub to keep main.js and other file imports clean:
require('./config'); require('./utils'); require('./rhythm'); require('./time'); require('./composers');
require('./fx'); require('./writer');

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

// Motif picks are delegated to `MotifSpreader.getBeatMotifPicks(layer, beatKey, max)`
// (kept in composers to centralize motif planning and state)

/**
 * Generates MIDI note events for source channels (subdiv-based timing)
 * @returns {void}
 */
playSubdivNotes = () => {
  setSubdivNoteParams();
  crossModulateRhythms();
  // console.log('Cross Modulation:', crossModulation, 'Last:', lastCrossMod);
  if((crossModulation+lastCrossMod)/rf(1.7,2.3)>rv(rf(1.8,2.8),[-.2,-.3],.05)){
const noteObjects = composer ? composer.getNotes() : [];
const motifNotes = activeMotif ? applyMotifToNotes(noteObjects, activeMotif) : noteObjects;
try {
  const layer = LM.layers[LM.activeLayer];
  if (layer && layer.beatMotifs) {
    const beatLen = (typeof tpBeat !== 'undefined' && Number.isFinite(Number(tpBeat)) && Number(tpBeat) > 0) ? Number(tpBeat) : 1;
    const beatKey = Math.floor(on / beatLen);
    const bucket = Array.isArray(layer.beatMotifs[beatKey]) ? layer.beatMotifs[beatKey] : [];
    const picks = bucket.length ? MotifSpreader.getBeatMotifPicks(layer, beatKey, ri(1, 3)) : [];
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

      p(c,{tick:bassCH===cCH3 ? on+rv(tpSubdiv*rf(.1),[-.01,.1],.5) : on+rv(tpSubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[bassCH,bassNote,bassCH===cCH3 ? velocity*rf(1.15,1.3) : binVel*rf(1.85,2)]});
      p(c,{tick:on+sustain*(bassCH===cCH3 ? rf(1.1,3) : rv(rf(.8,3.5))),vals:[bassCH,bassNote]});
    });
  }

  }
  }
} catch (e) { /* swallow — keep scheduling non-fatal */ }
    trackRhythm('subdiv', LM.layers[LM.activeLayer], true);
  } else {
    trackRhythm('subdiv', LM.layers[LM.activeLayer], false);
  }
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
  crossModulateRhythms();
  if((crossModulation+lastCrossMod)/rf(1.6,2.4)>rv(rf(1.8,2.2),[-.2,-.3],.05)){
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
      const picks = bucket.length ? MotifSpreader.getBeatMotifPicks(layer, beatKey, ri(1, 3)) : [];
      for (let _pi = 0; _pi < picks.length; _pi++) {
        const s = picks[_pi]; // use each pick once
        const stutterState = { stutters: new Map(), shifts: new Map(), global: {} };
      source.filter(sourceCH=>
  flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
  ).map(sourceCH=>{

  p(c,{tick:sourceCH===cCH1 ? on + rv(tpSubsubdiv*rf(1/9),[-.1,.1],.3) : on + rv(tpSubsubdiv*rf(1/3),[-.1,.1],.3),type:'on',vals:[sourceCH,s.note,sourceCH===cCH1 ? velocity*rf(.95,1.15) : binVel*rf(.95,1.03)]});
  p(c,{tick:on+sustain*(sourceCH===cCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,s.note]});

  stutterNotes({
    profile: 'source',
    channel: sourceCH,
    note: s.note,
    on,
    sustain,
    velocity,
    binVel,
    isPrimary: sourceCH === cCH1,
    shared: stutterState
  });

  reflectionCH=reflect[sourceCH];
  p(c,{tick:reflectionCH===cCH2 ? on+rv(tpSubsubdiv*rf(.2),[-.01,.1],.5) : on+rv(tpSubsubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[reflectionCH,s.note,reflectionCH===cCH2 ? velocity*rf(.5,.8) : binVel*rf(.55,.9)]});
  p(c,{tick:on+sustain*(reflectionCH===cCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,s.note]});

  stutterNotes({
    profile: 'reflection',
    channel: reflectionCH,
    note: s.note,
    on,
    sustain,
    velocity,
    binVel,
    isPrimary: reflectionCH === cCH2,
    shared: stutterState
  });

  if (rf()<clamp(.35*bpmRatio3,.2,.7)) {
    bassCH=reflect2[sourceCH]; bassNote=modClamp(s.note,12,35);
    p(c,{tick:bassCH===cCH3 ? on+rv(tpSubsubdiv*rf(.1),[-.01,.1],.5) : on+rv(tpSubsubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[bassCH,bassNote,bassCH===cCH3 ? velocity*rf(1.15,1.3) : binVel*rf(1.85,2)]});
    p(c,{tick:on+sustain*(bassCH===cCH3 ? rf(1.1,3) : rv(rf(.8,3.5))),vals:[bassCH,bassNote]});

    stutterNotes({
      profile: 'bass',
      channel: bassCH,
      note: bassNote,
      on,
      sustain,
      velocity,
      binVel,
      isPrimary: bassCH === cCH3,
      shared: stutterState
    });
  }
  });
}}}
} catch (e) { /* swallow — keep scheduling non-fatal */ }
  trackRhythm('subsubdiv', LM.layers[LM.activeLayer], true);
  } else {
    trackRhythm('subsubdiv', LM.layers[LM.activeLayer], false);
  }
}
