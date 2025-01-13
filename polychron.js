// Clean minimal code style with focus on direct & clear naming & structure, instead of distracting comments, excessive line breaks & empty lines. Global scope used where possible for cleaner simplicity.
require('./stage');
class RhythmComposer {
  binary(length) { let pattern=[];
    while (pattern.length < length) { pattern=pattern.concat(t.RhythmPattern.binary(randomInt(99))); }
    return patternLength(pattern, length);
  }
  hex(length) { let pattern=[];
    while (pattern.length < length) { pattern=pattern.concat(t.RhythmPattern.hex(randomInt(99).toString(16))); }
    return patternLength(pattern, length);
  }
  onsets(numbers) { if (typeof numbers==='object' && numbers.hasOwnProperty('make')) {
    numbers=makeOnsets(...numbers.make); }
    return t.RhythmPattern.onsets(numbers);
  }
  random(length, probOn) { return t.RhythmPattern.random(length, 1 - probOn); }
  prob(probs) { return t.RhythmPattern.probability(probs); }
  euclid(length, ones) { return t.RhythmPattern.euclid(length, ones); }
  rotate(pattern, rotations, direction="R", length=pattern.length) {
    if (direction==='?') { direction=m.random() < .5 ? 'L' : 'R'; }
    if (direction.toUpperCase()==='L') { rotations=(pattern.length - rotations) % pattern.length; }
    return patternLength(t.RhythmPattern.rotate(pattern, rotations), length);
  }
  morph(pattern, direction='both', length=pattern.length, probLow=.1, probHigh) {  let morph;
    morph=probHigh===undefined ? randomFloat(probLow) : randomFloat(probLow, probHigh);
    probHigh=probHigh===undefined ? probLow : probHigh;
    let morpheus=pattern.map((v, index)=>{
      let _=['up', 'down', 'both']; let d=direction==='?' ? (_[randomInt(_.length - 1)]) : direction.toLowerCase();
      let up=v < 1 ? m.min(v + morph, 1) : v;  let down=v > 0 ? m.max(v - morph, 0) : v;
      return (d==='up' ? up : d==='down' ? down : d==='both' ? (v < 1 ? up : down) : v);
    });
    return this.prob(patternLength(morpheus, length));
  }
}
class MeasureComposer extends RhythmComposer {
  setMeter() {const {MIN:a,MAX:b,WEIGHTS:c}=NUMERATOR; const {MIN:x,MAX:y,WEIGHTS:z}=DENOMINATOR; return [ r(a,b,c), r(x,y,z) ]; }
  setRhythm(method, ...args) {
    if (!this[method] || typeof this[method] !== 'function') {throw new Error(`Unknown rhythm method: ${method}`);}
    return this[method](...args);
  }
  setDivisions() {const { MIN, MAX, WEIGHTS }=DIVISIONS; return r(MIN, MAX, WEIGHTS);}
  setOctaveRange() {
    const { MIN, MAX, WEIGHTS } = OCTAVE;
    let [o1, o2] = [r(MIN, MAX, WEIGHTS), r(MIN, MAX, WEIGHTS)];
    while(o1===o2 && m.random<.3) o2 = o1 > MIN && o2 < MAX ? o2 + randomInt(-1,-2,1,2) : o1 > MIN ? o2 - randomInt(1,3) : o2 < MAX ? o2 + randomInt(1,3) : o1 > MIN ? o1 - randomInt(1,3) : o1 + randomInt(1,3);
    while (o1 < MIN ? o1++ : o1 > MAX ? o1-- : false);
    while (o2 < MIN ? o2++ : o2 > MAX ? o2-- : false);
    return [ o1, o2 ];
  }
  composeChord(octaveRange = null) {
    const { MIN, MAX, WEIGHTS } = VOICES;
    let voices = m.min(r(MIN, MAX, WEIGHTS), this.notes.length * 4);
    voices = subdivFreq > randomInt(10,20) ? m.max(1,m.floor(voices / randomInt(2,3))) : voices;
    const uniqueNotes = new Set();
    const [minOctave, maxOctave] = octaveRange || this.setOctaveRange();
    const rootNote = this.notes[randomInt(this.notes.length - 1)];
    let intervals = [], fallback = false;
    try {
      const shift=randomInt(1);
      switch (randomInt(2)) {
        case 0:
          intervals = [0, 2, 3 + m.round(m.random()*shift), 6 - m.round(m.random()*shift)].map(interval => interval * Math.floor(this.notes.length / 7));
          break;
        case 1:
          intervals = [0, 1, 3 + m.round(m.random()*shift), 5 + m.round(m.random()*shift)].map(interval => interval * Math.floor(this.notes.length / 7));
          break;
        default:
          intervals = Array.from({length: this.notes.length}, (_, i) => i);
          fallback = true;
      }
      return intervals.slice(0, voices).map((interval, index) => {
        const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
        let octave = randomInt(minOctave, maxOctave);
        let note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
        let triedAllSoftLimits = false;
        while (uniqueNotes.has(note)) {
          octave = octave < maxOctave ? octave + 1 : 
                  (octave > minOctave ? octave - 1 : 
                  (!triedAllSoftLimits ? (triedAllSoftLimits = true, OCTAVE.MIN) : 
                  (octave < OCTAVE.MAX ? octave + 1 : 
                  (() => { console.warn("No unique note found within hard limits, using existing note."); return false; })())));
          if (octave === false) break;
          note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
        }
        return { note };
      }).filter((noteObj, index, self) => 
        index === self.findIndex(n => n.note === noteObj.note)
      );
    } catch (e) {
      if (!fallback) {
        return this.composeChord(octaveRange);
      } else {
        console.warn(e.message);
        return this.composeChord(octaveRange);
      }
    }
  }
}
class ScaleComposer extends MeasureComposer {
  constructor(scaleName, root) { 
    super(); 
    this.root = root; 
    this.setScale(scaleName, root);  
  }
  setScale(scaleName, root) {
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }
  getNotes = () => this.composeChord();
}
class RandomScaleComposer extends ScaleComposer {
  constructor() { 
    super('', '');  
    this.randomScale();  
  }
  randomScale() {
    const randomScale = allScales[randomInt(allScales.length - 1)];
    const randomRoot = allNotes[randomInt(allNotes.length - 1)];
    this.setScale(randomScale, randomRoot);
  }
  getNotes = () => {
    this.randomScale();  
    return super.getNotes();  
  }
}
class ChordComposer extends MeasureComposer {
  constructor(progression) { 
    super();  
    this.setProgression(progression);  
  }
  setProgression(progression) {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!allChords.includes(chordSymbol)) {  
        console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;
      }
      return true;
    });
    this.progression = validatedProgression.map(t.Chord.get); 
    this.currentChordIndex = 0;
    this.notes = this.progression[0] ? this.progression[0].notes : [];
  }
  getNotes = () => {
    if (!this.progression.length) {
      console.warn('No valid chords in progression');
    } else {
      const chord = this.progression[this.currentChordIndex];
      this.notes = chord.notes;
    }
    const note = this.composeChord();
    this.currentChordIndex = m.random > (randomInt(150) / subdivFreq) ? this.currentChordIndex + randomInt(-2,2) % (this.progression.length - 1) : this.currentChordIndex;
    return note;
  }
}
class RandomChordComposer extends ChordComposer {
  constructor() { 
    super([]);  
    this.randomProgression();  
  }
  randomProgression() {
    const progressionLength = randomInt(1, 5);
    const randomProgression = [];
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = allChords[randomInt(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    this.setProgression(randomProgression);
  }
  getNotes = () => {
    this.randomProgression();  
    return super.getNotes();  
  }
}
class ModeComposer extends MeasureComposer {
  constructor(modeName, root) { 
    super(); 
    this.root = root; 
    this.setMode(modeName, root);  
  }
  setMode(modeName, root) {
    this.mode = t.Mode.get(modeName);
    this.notes = t.Mode.notes(this.mode, root);
  }
  getNotes = () => this.composeChord();
}
class RandomModeComposer extends ModeComposer {
  constructor() {
    super('', '');
    this.randomMode();
  }
  randomMode() {
    const randomMode = allModes[randomInt(allModes.length - 1)];
    const [root, modeName] = randomMode.split(' ');
    this.root = root; 
    this.setMode(modeName, root);    
  }
  getNotes = () => {
    this.randomMode();  
    return super.getNotes();  
  }
}
composers=(function() {  return COMPOSERS.map(composer=>
  eval(`(function() { return ${composer.return}; }).call({name: '${composer.name || ''}', root: '${composer.root || ''}', progression: ${JSON.stringify(composer.progression || [])}})`)  );  })();
(function csvMaestro() {
  p(c, ...['control_c', 'program_c'].flatMap(type => [
    ...[leftCH, leftCH2, rightCH, rightCH2].map(ch => ({
      type, values: [ch, ...(ch === leftCH || ch === leftCH2 ? (type === 'control_c' ? [10, 0] : [INSTRUMENT]) : (type === 'control_c' ? [10, 127] : [INSTRUMENT]))]})),
    { type: type === 'control_c' ? 'pitch_bend_c' : 'program_c', values: [centerCH, ...(type === 'control_c' ? [tuningPitchBend] : [INSTRUMENT])]}]));
  totalMeasures=randomInt(MEASURES.MIN, MEASURES.MAX);
  for (measureIndex=0; measureIndex < totalMeasures; measureIndex++) {
    composer=composers[randomInt(COMPOSERS.length - 1)];
    [numerator, denominator]=composer.setMeter();
    ({ midiMeter, midiBPM, ticksPerMeasure, ticksPerBeat, meterRatio }=midiSync());
    beatRhythm=beatRhythm < 1 ? new RhythmComposer().random(numerator) : beatRhythm;
    c.push(logUnit('measure')); beatRhythm=rhythm('beat', numerator, beatRhythm);
    p(c,{ tick: currentTick, type: 'bpm', values: [midiBPM] },{ tick: currentTick, type: 'meter', values: [midiMeter[0], midiMeter[1]] });
    for (beatIndex=0; beatIndex < numerator; beatIndex++) { 
      if (beatRhythm[beatIndex] > 0) {beatsOn++; beatsOff=0} else {beatsOn=0; beatsOff++;}
      beatStart=currentTick + beatIndex * ticksPerBeat;  c.push(logUnit('beat')); beatCount++;
        if (beatCount % beatsUntilBinauralShift < 1) {  beatCount=0; flipBinaural=!flipBinaural;
          beatsUntilBinauralShift=randomInt(2, 5);
          binauralFreqOffset=randomFloat(m.max(BINAURAL.MIN, binauralFreqOffset - 1), m.min(BINAURAL.MAX, binauralFreqOffset + 1));  }
        p(c, ...[leftCH, leftCH2, rightCH, rightCH2].map(ch => ({
          tick: beatStart, type: 'pitch_bend_c', 
          values: [ch, (ch === leftCH || ch === leftCH2) ? (flipBinaural ? binauralMinus : binauralPlus) : (flipBinaural ? binauralPlus : binauralMinus)]  })));
        if (m.random() < .3) { p(c,  ...['control_c'].flatMap(()=>{
          balanceOffset=randomInt(m.max(0, balanceOffset - 7), m.min(44, balanceOffset + 7));
          sideBias=randomInt(m.max(-15, sideBias - 5), m.min(15, sideBias + 5));
          leftOffset=m.min(127,m.max(0, balanceOffset + randomInt(7) + sideBias));
          rightOffset=m.min(127,m.max(0, 127 - balanceOffset - randomInt(7) + sideBias));
          centerOffset=m.min(127,(m.max(0, 64 + m.round(v(balanceOffset / randomInt(2,3))) * (m.random() < .5 ? -1 : 1) + sideBias)));
          _={ tick: beatStart, type: 'control_c' };
          return [...[leftCH, leftCH2, rightCH, rightCH2].map(ch => ({  ..._,
            values: [ch, 10, (ch === leftCH || ch === leftCH2) ? (flipBinaural ? leftOffset : rightOffset) : (flipBinaural ? rightOffset : leftOffset)]
          })), { ..._, values: [centerCH, 10, centerOffset] }];  })  );  }
        divsPerBeat=m.ceil(composer.setDivisions() * (meterRatio < 1 ? meterRatio : 1 / meterRatio));
        divRhythm=divRhythm < 1 ? new RhythmComposer().random(divsPerBeat) : divRhythm;
        divRhythm=rhythm('div', divsPerBeat, divRhythm); ticksPerDiv=ticksPerBeat / m.max(1, divsPerBeat);
      for (divIndex=0; divIndex < divsPerBeat; divIndex++) {
        if (divRhythm[divIndex] > 0) {divsOn++; divsOff=0} else {divsOn=0; divsOff++;}
        divStart=beatStart + divIndex * ticksPerDiv;  c.push(logUnit('division'));
        ({ MIN, MAX, WEIGHTS }=SUBDIVISIONS);
        subdivsPerDiv=r(MIN, MAX, WEIGHTS);  subdivFreq=subdivsPerDiv * divsPerBeat / meterRatio;
        subdivRhythm=subdivRhythm < 1 ? new RhythmComposer().random(subdivsPerDiv) : subdivRhythm;
        subdivRhythm=rhythm('subdiv', subdivsPerDiv, subdivRhythm);
        ticksPerSubdiv=ticksPerDiv / m.max(1, subdivsPerDiv);
        useSubdiv=m.random() < v(.3, [-.2, .2], .3);
        for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) {
          subdivStart=divStart + subdivIndex * ticksPerSubdiv;  c.push(logUnit('subdivision'));
          crossModulateRhythms=0;
          crossModulateRhythms+=randomFloat(2/3,(beatRhythm[beatIndex] > 0 ? 3 : m.min(randomFloat(.75,1.5), 3 / numerator + beatsOff * (1 / numerator)))) +
          randomFloat(.5,(divRhythm[divIndex] > 0 ? 2 : m.min(randomFloat(.5,1), 2 / divsPerBeat + divsOff * (1 / divsPerBeat)))) +
          randomFloat(1/3,(subdivRhythm[subdivIndex] > 0 ? 1 : m.min(randomFloat(.25,.5), 1 / subdivsPerDiv + subdivsOff * (1 / subdivsPerDiv))));
          composer.composeChord().forEach(({ note })=>{  
          if (crossModulateRhythms > randomFloat(1,9)) {  rest=m.random() * crossModulateRhythms < 1;
          if (subdivsOn % subdivsUntilNextRest<3 && (rest && (subdivsOn > randomInt(7, 22) || divsOn > randomInt(11,33)))) {
          subdivsOff++;  subdivsOn=0;
          subdivsUntilNextRest=m.min(randomInt(7), m.ceil(111 / m.max(33, divsPerBeat * subdivsPerDiv)));
          } else if (subdivsOff < randomInt(11)) {  subdivsOn++; subdivsOff=0
          on=subdivStart + v(m.random() * ticksPerSubdiv * .07, [-.07, .07], .3);
          subdivSustain=v(randomFloat(m.max(ticksPerDiv * .5, ticksPerDiv / subdivsPerDiv), (ticksPerBeat * (.3 + m.random() * .7))), [.1, .2], [-.05, -.1], .1);
          divSustain=v(randomFloat(ticksPerDiv * .8, (ticksPerBeat * (.3 + m.random() * .7))), [.1, .3], [-.05, -.1], .1);
          sustain=(useSubdiv ? subdivSustain : divSustain) * v(randomFloat(.9, 1.2));
          binauralVelocity=v(velocity * randomFloat(.33, .44));
          p(c,  ...['C', 'L', 'R'].map(side=>[
            { tick: side==='C' ? on : on + v(ticksPerSubdiv * m.random() * .1, [-.06, .03], .3), type: 'note_on_c', values: [side==='C' ? centerCH : (flipBinaural ? (side==='L' ? leftCH2 : rightCH2) : (side==='L' ? leftCH : rightCH)), note, side==='C' ? velocity * randomFloat(.95, 1.05) : binauralVelocity * randomFloat(.97, 1.03)] },
            { tick: on + sustain * (side==='C' ? 1 : v(randomFloat(.96, 1.01))), values: [side==='C' ? centerCH : (flipBinaural ? (side==='L' ? leftCH2 : rightCH2) : (side==='L' ? leftCH : rightCH)), note] }
          ]).flat()  );            
          } else {  subdivsOff++; subdivsOn=0  }}});}}}
    currentTick+=ticksPerMeasure;  currentTime+=secondsPerMeasure;  }
  c=c.filter(item=>item !== null).sort((a, b)=>a.tick - b.tick);  c.forEach(_=>{
    composition+=`1, ${_.tick || 0}, ${_.type || 'note_off_c'}, ${_.values.join(', ')}\n`;
    finalTick=_.tick;  });
  composition+=finale();  fs.writeFileSync('output.csv', composition);
  console.log('output.csv created. Track Length:', finalTime);
})();
