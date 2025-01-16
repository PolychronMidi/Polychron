// Clean minimal code style with focus on direct & clear naming & structure, instead of distracting comments, excessive line breaks & empty lines. Global scope used where possible for cleaner simplicity.
require('./stage');
class RhythmComposer {
  binary(length) { let pattern=[];
    while (pattern.length < length) { pattern=pattern.concat(t.RhythmPattern.binary(ri(99))); }
    return patternLength(pattern, length);
  }
  hex(length) { let pattern=[];
    while (pattern.length < length) { pattern=pattern.concat(t.RhythmPattern.hex(ri(99).toString(16))); }
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
    morph=probHigh===undefined ? rf(probLow) : rf(probLow, probHigh);
    probHigh=probHigh===undefined ? probLow : probHigh;
    let morpheus=pattern.map((v, index)=>{
      let _=['up', 'down', 'both']; let d=direction==='?' ? (_[ri(_.length - 1)]) : direction.toLowerCase();
      let up=v < 1 ? m.min(v + morph, 1) : v;  let down=v > 0 ? m.max(v - morph, 0) : v;
      return (d==='up' ? up : d==='down' ? down : d==='both' ? (v < 1 ? up : down) : v);
    });
    return this.prob(patternLength(morpheus, length));
  }
}
class MeasureComposer extends RhythmComposer {
  getMeter() {const {min:a,max:b,weights:c}=NUMERATOR; const {min:x,max:y,weights:z}=DENOMINATOR; return [ rw(a,b,c), rw(x,y,z) ]; }
  getRhythm(method, ...args) {
    if (!this[method] || typeof this[method] !== 'function') {throw new Error(`Unknown rhythm method: ${method}`);}
    return this[method](...args);
  }
  getDivisions() {const { min, max, weights }=DIVISIONS; return rw(min, max, weights);}
  getSubdivisions() {const { min, max, weights }=SUBDIVISIONS; return rw(min, max, weights);}
  getOctaveRange() {
    const { min, max, weights } = OCTAVE;
    let [o1, o2] = [rw(min, max, weights), rw(min, max, weights)];
    while (o1 === o2) {  o2 = m.max(min, m.min(max, o2 + ri(-3, 3)));  }
    return [ o1, o2 ];
  }
  getVoices() {
    const { min, max, weights } = VOICES;
    const v = m.min(rw(min, max, weights), this.notes.length * 4);
    return subdivFreq > ri(10,20) ? m.max(1,m.floor(v / ri(2,3))) : v;
  }
  getNotes(octaveRange = null) {
    const voices = this.getVoices();
    const uniqueNotes = new Set();
    const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    const rootNote = this.notes[ri(this.notes.length - 1)];
    let intervals = [], fallback = false;
    try {  const shift=ri(1);
      switch (ri(2)) {
        case 0:
          intervals = [0, 2, 3 + m.round(m.random()*shift), 6 - m.round(m.random()*shift)].map(interval => interval * m.floor(this.notes.length / 7));  break;
        case 1:
          intervals = [0, 1, 3 + m.round(m.random()*shift), 5 + m.round(m.random()*shift)].map(interval => interval * m.floor(this.notes.length / 7));  break;
        default:
          intervals = Array.from({length: this.notes.length}, (_, i) => i);  fallback = true;  }
      return intervals.slice(0, voices).map((interval, index) => {
        const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
        let octave = ri(minOctave, maxOctave);
        let note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
        let triedAllSoftLimits = false;
        while (uniqueNotes.has(note)) {
octave = octave < maxOctave ? octave++ : (octave > minOctave ? octave-- : (!triedAllSoftLimits ? (triedAllSoftLimits = true, OCTAVE.min) : (octave < OCTAVE.max ? octave++ : (() => { return false; })())));
if (octave === false) break; note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;  }
        return { note };
      }).filter((noteObj, index, self) => 
        index === self.findIndex(n => n.note === noteObj.note)
      ); }  catch (e) { if (!fallback) { return this.getNotes(octaveRange); } else {
      console.warn(e.message);  return this.getNotes(octaveRange);  }}}}
class ScaleComposer extends MeasureComposer {
  constructor(scaleName, root) { 
    super(); 
    this.root = root; 
    this.noteSet(scaleName, root);  
  }
  noteSet(scaleName, root) {
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }
  x = () => this.getNotes();
}
class RandomScaleComposer extends ScaleComposer {
  constructor() { 
    super('','');  
    this.noteSet();  
  }
  noteSet() {
    const randomScale = allScales[ri(allScales.length - 1)];
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomScale, randomRoot);
  }
  x = () => { this.noteSet();  return super.x();  }
}
class ChordComposer extends MeasureComposer {
  constructor(progression) { 
    super();  
    this.noteSet(progression, 'R');
  }
  noteSet(progression, direction = 'R') {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!allChords.includes(chordSymbol)) { console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;  }  return true;  });
    if (validatedProgression.length === 0) {console.warn('No valid chords in progression');
    } else {
      this.progression = validatedProgression.map(t.Chord.get); 
      this.currentChordIndex = this.currentChordIndex || 0;
      let increment = 0;
      switch (direction) {
        case 'R': increment = 1; break;
        case 'L': increment = -1; break;
        case 'E': increment = Math.random() < 0.5 ? 1 : -1; break;
        case '?': increment = ri(-2, 2); break;
        default:
          console.warn('Invalid direction specified, defaulting to right');
          increment = 1;
      }
      this.currentChordIndex += m.random > (ri(150) / subdivFreq) ? 
        increment % (this.progression.length) : 0;
      this.currentChordIndex = (this.currentChordIndex + this.progression.length) % this.progression.length;
      this.notes = this.progression[this.currentChordIndex].notes;
    }
  }
  x = () => this.getNotes();
}
class RandomChordComposer extends ChordComposer {
  constructor() { 
    super([]);  
    this.noteSet();  
  }
  noteSet() {
    const progressionLength = ri(1, 5);
    const randomProgression = [];
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = allChords[ri(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    super.noteSet(randomProgression, '?');
  }
  x = () => { this.noteSet();  return super.x();  }
}
class ModeComposer extends MeasureComposer {
  constructor(modeName, root) { 
    super(); 
    this.root = root; 
    this.noteSet(modeName, root);  
  }
  noteSet(modeName, root) {
    this.mode = t.Mode.get(modeName);
    this.notes = t.Mode.notes(this.mode, root);
  }
  x = () => this.getNotes();
}
class RandomModeComposer extends ModeComposer {
  constructor() {
    super('', '');
    this.noteSet();
  }
  noteSet() {
    const randomMode = allModes[ri(allModes.length - 1)];
    const [root, modeName] = randomMode.split(' ');
    this.root = root; 
    super.noteSet(modeName, root);    
  }
  x = () => { this.noteSet();  return super.x();  }
}
composers=(function() {  return COMPOSERS.map(composer=>
  eval(`(function() { return ${composer.return}; }).call({name: '${composer.name || ''}', root: '${composer.root || ''}', progression: ${JSON.stringify(composer.progression || [])}})`)  );  })();
(function csvMaestro() {  totalMeasures=ri(MEASURES.min, MEASURES.max);
p(c, ...['control_c', 'program_c'].flatMap(type => [ ...source.map(ch => ({
  type, values: [ch, ...(ch.toString().startsWith('leftCH') ? (type === 'control_c' ? [10, 0] : [primaryInstrument]) : (type === 'control_c' ? [10, 127] : [primaryInstrument]))]})),
  { type: type === 'control_c' ? 'pitch_bend_c' : 'program_c', values: [centerCH1, ...(type === 'control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { type: type === 'control_c' ? 'pitch_bend_c' : 'program_c', values: [centerCH2, ...(type === 'control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));
for (measureIndex=0; measureIndex < totalMeasures; measureIndex++) {
  composer=composers[ri(COMPOSERS.length - 1)]; [numerator, denominator]=composer.getMeter(); midiSync();
  beatRhythm=beatRhythm < 1 ? new RhythmComposer().random(numerator) : beatRhythm;//init
  beatRhythm=rhythm('beat', numerator, beatRhythm); c.push(logUnit('measure'));
  p(c,{ tick: currentTick, type: 'bpm', values: [midiBPM] },{ tick: currentTick, type: 'meter', values: [midiMeter[0], midiMeter[1]] });
  for (beatIndex=0; beatIndex < numerator; beatIndex++) { 
    if (beatRhythm[beatIndex] > 0) {beatsOn++; beatsOff=0;} else {beatsOn=0; beatsOff++;}
    beatStart=currentTick + beatIndex * ticksPerBeat; c.push(logUnit('beat')); beatCount++;
    if (beatCount % beatsUntilBinauralShift < 1) {  beatCount=0; flipBinaural=!flipBinaural;
      beatsUntilBinauralShift=ri(numerator * meterRatio, 7);
      binauralFreqOffset=rf(m.max(BINAURAL.min, binauralFreqOffset - 1), m.min(BINAURAL.max, binauralFreqOffset + 1));  }
    p(c, ...[...source, ...mirror].map(ch => ({
      tick: beatStart, type: 'pitch_bend_c', values: [ch, ch.toString().startsWith('leftCH') ? (flipBinaural ? binauralMinus : binauralPlus) : (flipBinaural ? binauralPlus : binauralMinus)]  })));
    if (m.random() < .3 || firstLoop<1 || beatCount % beatsUntilBinauralShift < 1) { firstLoop=1; 
      p(c, ...['control_c'].flatMap(()=>{
      balanceOffset=ri(m.max(0, balanceOffset - 7), m.min(55, balanceOffset + 7));
      sideBias=ri(m.max(-15, sideBias - 5), m.min(15, sideBias + 5));
      leftBalance=m.min(0,m.max(56, balanceOffset + ri(7) + sideBias));
      rightBalance=m.max(127,m.min(72, 127 - balanceOffset - ri(7) + sideBias));
      centerBalance=m.min(96,(m.max(32, 64 + m.round(rv(balanceOffset / ri(2,3))) * (m.random() < .5 ? -1 : 1) + sideBias)));
      _={ tick: beatStart, type: 'control_c' };
      return [  ...[...source, ...mirror].map(ch => ({  ..._,
        values: [ch, 10, ch.toString().startsWith('leftCH') ? (flipBinaural ? leftBalance : rightBalance) : (flipBinaural ? rightBalance : leftBalance)]  })),
        { ..._, values: [centerCH1, 10, centerBalance] },{ ..._, values: [centerCH2, 10, centerBalance] },
        ...mirror.map(ch =>({ ..._, values: [ch, 7, ch===centerCH2 ? ri(35,50) : ri(55,85)]//volume
    }))  ];  })  );  }
    divsPerBeat=m.ceil(composer.getDivisions() * (meterRatio < 1 ? rf(.98,1.1) : rf(rf(.99,1.05),meterRatio) / meterRatio));
    divRhythm=divRhythm < 1 ? new RhythmComposer().random(divsPerBeat) : divRhythm;
    divRhythm=rhythm('div', divsPerBeat, divRhythm); ticksPerDiv=ticksPerBeat / m.max(1, divsPerBeat);
    for (divIndex=0; divIndex < divsPerBeat; divIndex++) {
      if (divRhythm[divIndex] > 0) {divsOn++; divsOff=0;} else {divsOn=0; divsOff++;}
      divStart=beatStart + divIndex * ticksPerDiv; c.push(logUnit('division'));
      subdivsPerDiv=m.ceil(composer.getSubdivisions() * (meterRatio < 1 ? rf(.98,1.1) : rf(rf(.99,1.05),meterRatio) / meterRatio));
      subdivFreq=subdivsPerDiv * divsPerBeat * (meterRatio < 1 ? rf(.98,1.1) : rf(rf(.99,1.05),meterRatio) / meterRatio);
      subdivRhythm=subdivRhythm < 1 ? new RhythmComposer().random(subdivsPerDiv) : subdivRhythm;
      subdivRhythm=rhythm('subdiv', subdivsPerDiv, subdivRhythm);
      ticksPerSubdiv=ticksPerDiv / m.max(1, subdivsPerDiv);
      useSubdiv=m.random() < rv(.3, [-.2, .2], .3);
      for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) {
        subdivStart=divStart + subdivIndex * ticksPerSubdiv; c.push(logUnit('subdivision')); crossModulateRhythms=0;
        crossModulateRhythms+=rf(2/3,(beatRhythm[beatIndex] > 0 ? 3 : m.min(rf(.75,1.5), 3 / numerator + beatsOff * (1 / numerator)))) +
        rf(.5,(divRhythm[divIndex] > 0 ? 2 : m.min(rf(.5,1), 2 / divsPerBeat + divsOff * (1 / divsPerBeat)))) +
        rf(1/3,(subdivRhythm[subdivIndex] > 0 ? 1 : m.min(rf(.25,.5), 1 / subdivsPerDiv + subdivsOff * (1 / subdivsPerDiv))));
composer.getNotes().forEach(({ note }) => {
  if (crossModulateRhythms > rf(1,9)) {  rest=m.random() * crossModulateRhythms < 1;
    if (subdivsOn % subdivsUntilNextRest<3 && (rest && (subdivsOn > ri(7, 22) || divsOn > ri(11,33)))) {
    subdivsOff++;  subdivsOn=0;
    subdivsUntilNextRest=m.min(ri(7), m.ceil(111 / m.max(33, divsPerBeat * subdivsPerDiv)));
    } else if (subdivsOff < ri(11)) {  subdivsOn++; subdivsOff=0;
    on=subdivStart + rv(ticksPerSubdiv * rf(1/3), [-.01, .07], .3);
    subdivSustain=rv(rf(m.max(ticksPerDiv * .5, ticksPerDiv / subdivsPerDiv), (ticksPerBeat * (.3 + m.random() * .7))), [.1, .2], [-.05, -.1], .1);
    divSustain=rv(rf(ticksPerDiv * .8, (ticksPerBeat * (.3 + m.random() * .7))), [.1, .3], [-.05, -.1], .1);
    sustain=(useSubdiv ? subdivSustain : divSustain) * rv(rf(.8, 1.3));
    binauralVelocity=rv(velocity * rf(.33, .44));
events = source.map(side => { reflection=reflectionMap[side]; sourceToReflect = [
{tick: side === centerCH1 ? on : on + rv(ticksPerSubdiv * rf(1/3), [-.01, .05], .3), type: 'note_on_c', values: [channel, note, side === centerCH1 ? velocity * rf(.9, 1.1) : binauralVelocity * rf(.97, 1.03)]},
{tick: on + sustain * (side === centerCH1 ? 1 : rv(rf(.92, 1.03))), values: [channel, note]},
...(reflection !== centerCH2 && (beatCount % ri(111)) < 3 ? [{tick: on, type: 'program_c', values: [reflection, tertiaryInstruments[ri(tertiaryInstruments.length - 1)]]}] : [])
    ];  return [  ...sourceToReflect,
{tick: side === centerCH1 ? on + rv(ticksPerSubdiv * rf(-.2,.2)) : on + rv(ticksPerSubdiv * rf(-1/3,1/3), [-.01, .1], .5), type: 'note_on_c', values: [reflection, note, side === centerCH1 ? velocity * rf(.8, 1.1) : binauralVelocity * rf(.8, 1.15)]},
{tick: on + sustain * (side === centerCH1 ? rf(.7,1.3) : rv(rf(.65, 1.5))), values: [reflection, note]}  ];  }).flat();
    p(c, ...events);  } else {  subdivsOff++; subdivsOn=0;  }}});}}}
  currentTick+=ticksPerMeasure;  currentTime+=secondsPerMeasure;  }
c=c.filter(item=>item !== null).sort((a, b)=>a.tick - b.tick);  c.forEach(_=>{
composition+=`1, ${_.tick || 0}, ${_.type || 'note_off_c'}, ${_.values.join(', ')}\n`;  finalTick=_.tick;  });
composition+=finale();  fs.writeFileSync('output.csv', composition);
console.log('output.csv created. Track Length:', finalTime);
})();
