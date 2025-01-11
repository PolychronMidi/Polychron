// Clean minimal code style with focus on direct & clear naming & structure, instead of distracting comments, excessive line breaks & empty lines. Global scope used where possible for cleaner simplicity.
require('./stage');
class RhythmComposer {
  binary(length = 8) { let pattern = [];
    while (pattern.length < length) {
      pattern = pattern.concat(t.RhythmPattern.binary(randomInt(99)));
    }
    return adjustPatternLength(pattern, length);
  }
  hex(length = 8) { let pattern = [];
    while (pattern.length < length) {
      pattern = pattern.concat(t.RhythmPattern.hex(randomInt(99).toString(16)));
    }
    return adjustPatternLength(pattern, length);
  }
  onsets(numbers) { if (typeof numbers === 'object' && numbers.hasOwnProperty('make')) {
    numbers = makeOnsets(...numbers.make); }
    return t.RhythmPattern.onsets(numbers);
  }
  random(length, probOn = 0.5) { return t.RhythmPattern.random(length, 1 - probOn); }
  prob(probs) { return t.RhythmPattern.probability(probs); }
  euclid(length, ones) { return t.RhythmPattern.euclid(length, ones); }
  rotate(pattern, rotations, direction = 'R', length = pattern.length) {
    if (direction === '?') { direction = m.random() < 0.5 ? 'L' : 'R'; }
    if (direction.toUpperCase() === 'L') { rotations = (pattern.length - rotations) % pattern.length; }
    return adjustPatternLength(t.RhythmPattern.rotate(pattern, rotations), length);
  }
  morph(pattern, direction = 'both', length = pattern.length, probLow = 0.1, probHigh) {
    let morph;
    morph = probHigh === undefined ? randomFloat(probLow) : randomFloat(probLow, probHigh);
    probHigh = probHigh === undefined ? probLow : probHigh;
    let morpheus = pattern.map((v, index) => {
      let _ = ['up', 'down', 'both']; let d = direction === '?' ? (_[randomInt(_.length - 1)]) : direction.toLowerCase();
      let up = v < 1 ? m.min(v + morph, 1) : v;
      let down = v > 0 ? m.max(v - morph, 0) : v;
      return (d === 'up' ? up : d === 'down' ? down : d === 'both' ? (v < 1 ? up : down) : v);
    });
    return this.prob(adjustPatternLength(morpheus, length));
  }
}
class MeasureComposer extends RhythmComposer {
  setMeter() {const {MIN:a,MAX:b,WEIGHTS:c}=NUMERATOR; const {MIN:x,MAX:y,WEIGHTS:z}=DENOMINATOR; 
  return [ r(a,b,c), r(x,y,z) ]; }
  setOctave() {const { MIN, MAX, WEIGHTS } = OCTAVE; return r(MIN, MAX, WEIGHTS);}
  setDivisions() {const { MIN, MAX, WEIGHTS } = DIVISIONS; return r(MIN, MAX, WEIGHTS);}
  setRhythm(method, ...args) {
    if (!this[method] || typeof this[method] !== 'function') {throw new Error(`Unknown rhythm method: ${method}`);}
    return this[method](...args);
  }
  composeNote() {
    const note = this.composeRawNote();
    const midiNote = t.Note.midi(`${note}${this.setOctave()}`);
    if (midiNote === null) throw new Error(`Invalid note composed: ${note}${this.setOctave()}`);
    return midiNote;
  }
  composeChord() {
    const { MIN, MAX, WEIGHTS } = VOICES; const voices = r(MIN, MAX, WEIGHTS);
    const uniqueNotes = new Set();
    return Array(voices).fill().map(() => {
      let note; do {  note = this.composeNote();
      } while (uniqueNotes.has(note));
      uniqueNotes.add(note);
      return { note };
  });  }
}
class ScaleComposer extends MeasureComposer {
  constructor(scaleName, root) {  super(); this.root = root; this.setScale(scaleName, root);  }
  setScale(scaleName, root) {
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }
  composeRawNote = () => this.notes[randomInt(this.notes.length - 1)];
}
class RandomScaleComposer extends ScaleComposer {
  constructor() {  super('', '');  this.randomScale();  }
  randomScale() {
    const randomScale = allScales[randomInt(allScales.length - 1)];
    const randomRoot = allNotes[randomInt(allNotes.length - 1)];
    this.setScale(randomScale, randomRoot);
  }
  composeRawNote() {  this.randomScale();  return super.composeRawNote();  }
}
class ChordComposer extends MeasureComposer {
  constructor(progression) {  super();  this.setProgression(progression);  }
  setProgression(progression) {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!allChords.includes(chordSymbol)) {  console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;
      }
      return true;
    });
    this.progression = validatedProgression.map(t.Chord.get); this.currentChordIndex = 0;
  }
  composeRawNote() {
    const chord = this.progression[this.currentChordIndex];
    const noteIndex = randomInt(chord.notes.length - 1);
    this.currentChordIndex = (this.currentChordIndex + 1) % (this.progression.length - 1);
    return chord.notes[noteIndex];
  }
}
class RandomChordComposer extends ChordComposer {
  constructor() {  super([]);  this.randomProgression();  }
  randomProgression() {
    const progressionLength = randomInt(3, 8);
    const randomProgression = [];
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = allChords[randomInt(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    this.setProgression(randomProgression);
  }
  composeRawNote() {  this.randomProgression();  return super.composeRawNote();  }
}
class ModeComposer extends MeasureComposer {
  constructor(modeName, root) {  super(); this.root = root; this.setMode(modeName, root);  }
  setMode(modeName, root) {
    this.mode = t.Mode.get(modeName);
    this.notes = t.Mode.notes(this.mode, root);
  }
  composeRawNote = () => this.notes[randomInt(this.notes.length - 1)];
}
class RandomModeComposer extends ModeComposer {
  constructor() {
    super('', '');
    this.randomMode();
  }
  randomMode() {
    const randomMode = allModes[randomInt(allModes.length - 1)];
    const [root, modeName] = randomMode.split(' ');
    this.root = root; this.setMode(modeName, root);    
  }
  composeRawNote() {  this.randomMode();  return super.composeRawNote();  }
}
(function csvMaestro() {
  p(c,  ...['control_c', 'program_c'].flatMap(type => [
    { type, values: [flipBinaural ? leftCH2 : leftCH, ...(type === 'control_c' ? [10, 0] : [INSTRUMENT])] },
    { type, values: [flipBinaural ? rightCH2 : rightCH, ...(type === 'control_c' ? [10, 127] : [INSTRUMENT])] },      
    { type: type === 'control_c' ? 'pitch_bend_c' : 'program_c', values: [centerCH, ...(type === 'control_c' ? [tuningPitchBend] : [INSTRUMENT])] }
  ])  );
  totalMeasures = randomInt(MEASURES.MIN, MEASURES.MAX);
  for (measureIndex = 0; measureIndex < totalMeasures; measureIndex++) {
    randomComposer = randomInt(COMPOSERS.length - 1);
    composers = (function() {  return COMPOSERS.map(composer => 
      eval(`(function() { return ${composer.return}; }).call({name: '${composer.name || ''}', root: '${composer.root || ''}', progression: ${JSON.stringify(composer.progression || [])}})`)  );  })();
    composer = composers[randomComposer];
    [numerator, denominator] = composer.setMeter();
    ({ midiMeter, midiBPM, ticksPerMeasure, ticksPerBeat, meterRatio } = midiSync());
    lastBeatRhythm = lastBeatRhythm < 1 ? new RhythmComposer().random(numerator) : lastBeatRhythm;
    c.push(logUnit('measure')); beatRhythm = rhythm('beat', numerator, lastBeatRhythm); lastBeatRhythm = beatRhythm;
    p(c,
      { tick: currentTick, type: 'meter', values: [midiMeter[0], midiMeter[1]] },
      { tick: currentTick, type: 'bpm', values: [midiBPM] }
      );
    for (beatIndex = 0; beatIndex < numerator; beatIndex++) { 
      if (beatRhythm[beatIndex] > 0) {beatsOn++; beatsOff = 0}
      else {beatsOn = 0; beatsOff++;}
      beatStart = currentTick + beatIndex * ticksPerBeat;  c.push(logUnit('beat')); beatCount++;
        if (beatCount % beatsUntilBinauralShift < 1) {  beatCount = 0;
          flipBinaural = !flipBinaural;
          beatsUntilBinauralShift = randomInt(2, 5);
          binauralFreqOffset = randomFloat(m.max(BINAURAL.MIN, lastBinauralFreqOffset - 1), m.min(BINAURAL.MAX, lastBinauralFreqOffset + 1));
        }
        p(c,
          { tick: beatStart, type: 'pitch_bend_c', values: [flipBinaural ? [leftCH2, binauralMinus] : [leftCH, binauralPlus]] },
          { tick: beatStart, type: 'pitch_bend_c', values: [flipBinaural ? [rightCH2, binauralPlus] : [rightCH, binauralMinus]] }
        );
        if (m.random() < .3) { p(c,  ...['control_c'].flatMap(() => {
          balanceOffset = m.round(v(randomInt(22)));
          sideBias = randomInt(-11,11);
          leftOffset = m.min(127,m.max(0, balanceOffset + randomInt(11) + sideBias));
          rightOffset = m.min(127,m.max(0, 127 - balanceOffset - randomInt(11) + sideBias));
          centerOffset = m.min(127,(m.max(0, 64 + m.round(v(balanceOffset / 2)) * (m.random() < 0.5 ? -1 : 1) + sideBias)));
          _ = { tick: beatStart, type: 'control_c' };
          return [
            { ..._, values: [flipBinaural ? leftCH2 : leftCH, 10, leftOffset] },
            { ..._, values: [flipBinaural ? rightCH2 : rightCH, 10, rightOffset] },
            { ..._, values: [centerCH, 10, centerOffset] }
        ];  })  );  }
        divsPerBeat = m.ceil(composer.setDivisions() * (meterRatio < 1 ? meterRatio : 1 / meterRatio));
        lastDivRhythm = lastDivRhythm < 1 ? new RhythmComposer().random(divsPerBeat) : lastDivRhythm;
        divRhythm = rhythm('div', divsPerBeat, lastDivRhythm); lastDivRhythm = divRhythm; ticksPerDiv = ticksPerBeat / m.max(1, divsPerBeat);
      for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
        if (divRhythm[divIndex] > 0) {divsOn++; divsOff = 0}
        else {divsOn = 0; divsOff++;}
        divStart = beatStart + divIndex * ticksPerDiv;  c.push(logUnit('division'));
        ({ MIN, MAX, WEIGHTS } = SUBDIVISIONS);  subdivsPerDiv = r(MIN, MAX, WEIGHTS);
        lastSubdivRhythm = lastSubdivRhythm < 1 ? new RhythmComposer().random(subdivsPerDiv) : lastSubdivRhythm;
        subdivRhythm = rhythm('subdiv', subdivsPerDiv, lastSubdivRhythm);  lastSubdivRhythm = subdivRhythm;
        ticksPerSubdiv = ticksPerDiv / m.max(1, subdivsPerDiv);
        useSubdiv = m.random() < v(.3, [-.2, .2], .3);
        for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
          subdivStart = divStart + subdivIndex * ticksPerSubdiv;  c.push(logUnit('subdivision'));
          let playChance = (beatRhythm[beatIndex] > 0 ? 1 : 1 / numerator + beatsOff * 1 / numerator) +
          (divRhythm[divIndex] > 0 ? 1 : 1 / divsPerBeat + divsOff * 1 / divsPerBeat) +
          (subdivRhythm[subdivIndex] > 0 ? 1 : 1 / subdivsPerDiv + subdivsOff * 1 / subdivsPerDiv);
          if (m.random() < m.max(1, playChance)) {
          composer.composeChord().forEach(({ note }) => {  noteCount++; rest = m.random() < .15;
          if (noteCount % notesUntilRest < 1 || subdivsOn > randomInt(7, 22) || divsOn > randomInt(11,33) && rest) {  
          rest = false;  subdivsOff++;  subdivsOn = noteCount = notesUntilRest = 0;
          notesUntilRest = m.max(randomInt(3,11), randomInt(randomInt(22,66), randomInt(111, 333) / m.max(20, divsPerBeat * subdivsPerDiv)));
          } else if (subdivsOff < randomInt(11)) {  subdivsOn++; subdivsOff = 0
          on = subdivStart + v(m.random() * ticksPerSubdiv * .07, [-.07, .07], .3);
          subdivSustain = v(randomFloat(m.max(ticksPerDiv * .5, ticksPerDiv / subdivsPerDiv), (ticksPerBeat * (.3 + m.random() * .7))), [.1, .2], [-.05, -.1], .1);
          divSustain = v(randomFloat(ticksPerDiv * .8, (ticksPerBeat * (.3 + m.random() * .7))), [.1, .3], [-.05, -.1], .1);
          sustain = (useSubdiv ? subdivSustain : divSustain) * v(randomFloat(.9, 1.2));
          binauralVelocity = v(velocity * randomFloat(.33, .44));
          p(c,  ...['C', 'L', 'R'].map(side => [
            { tick: side === 'C' ? on : on + v(ticksPerSubdiv * m.random() * .1, [-.06, .03], .3), type: 'note_on_c', values: [side === 'C' ? centerCH : (flipBinaural ? (side === 'L' ? leftCH2 : rightCH2) : (side === 'L' ? leftCH : rightCH)), note, side === 'C' ? velocity * randomFloat(.95, 1.05) : binauralVelocity * randomFloat(.97, 1.03)] },
            { tick: on + sustain * (side === 'C' ? 1 : v(randomFloat(.96, 1.01))), values: [side === 'C' ? centerCH : (flipBinaural ? (side === 'L' ? leftCH2 : rightCH2) : (side === 'L' ? leftCH : rightCH)), note] }
          ]).flat()  );
    }});}}}}
    currentTick += ticksPerMeasure;  currentTime += secondsPerMeasure;  }
  c = c.filter(item => item !== null).sort((a, b) => a.tick - b.tick);  c.forEach(_ => {
    composition += `1, ${_.tick || 0}, ${_.type || 'note_off_c'}, ${_.values.join(', ')}\n`;
    finalTick = _.tick;  });
  composition += finale();  fs.writeFileSync('output.csv', composition);
  console.log('output.csv created. Track Length:', finalTime);
})();
