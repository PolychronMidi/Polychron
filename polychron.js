// Clean minimal code style with focus on direct & clear naming & structure, instead of distracting comments, excessive line breaks & empty lines. Global scope used where possible for cleaner simplicity.
require('./stage');
class RhythmComposer {
  onsets(numbers) { if (typeof numbers === 'object' && numbers.hasOwnProperty('build')) {
    numbers = buildOnsetsOfLength(...numbers.build); }
    return t.RhythmPattern.onsets(numbers);
  }
  random(length, probabilityOfOn = 0.5) { return t.RhythmPattern.random(length, probabilityOfOn - 1); }
  probability(probabilities) { return t.RhythmPattern.probability(probabilities); }
  euclid(length, numberOfOn) { return t.RhythmPattern.euclid(length, numberOfOn); }
  rotate(pattern, rotationsRight) { return t.RhythmPattern.rotate(pattern, rotationsRight); }
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
    ({ midiMeter, midiBPM, ticksPerMeasure, ticksPerBeat } = midiSync());
    c.push(logUnit('measure'));
    beatRhythm = Math.random() < .3 ? 
    composer.setRhythm('euclid', numerator, closestDivisor(numerator, Math.ceil(randomFloat(2, numerator / randomFloat(numerator / numerator - randomFloat(1.2)))))) : 
    Math.random() < .5 ? 
      composer.setRhythm('random', numerator, v(.97,[-.3,.3],.2)) : 
      composer.setRhythm('onsets',{ build: [numerator,  () => [1, 3]] });
    p(c,
      { tick: currentTick, type: 'meter', values: [midiMeter[0], midiMeter[1]] },
      { tick: currentTick, type: 'bpm', values: [midiBPM] }
      );
    for (beatIndex = 0; beatIndex < numerator; beatIndex++) { 
      if (beatRhythm[beatIndex] === 1) {beatOnCount++; beatOffCount = 0}
      else {beatOnCount = 0; beatOffCount++;}
      beatStart = currentTick + beatIndex * ticksPerBeat;  c.push(logUnit('beat')); beatCount++;
        if (beatCount % beatsUntilBinauralShift === 0) {  beatCount = 0;
          flipBinaural = !flipBinaural;
          beatsUntilBinauralShift = randomInt(2, 5);
          binauralFreqOffset = randomFloat(Math.max(BINAURAL.MIN, lastBinauralFreqOffset - 1), Math.min(BINAURAL.MAX, lastBinauralFreqOffset + 1));
        }
        p(c,
          { tick: beatStart, type: 'pitch_bend_c', values: [flipBinaural ? [leftCH2, binauralMinus] : [leftCH, binauralPlus]] },
          { tick: beatStart, type: 'pitch_bend_c', values: [flipBinaural ? [rightCH2, binauralPlus] : [rightCH, binauralMinus]] }
        );
        if (Math.random() > .7) { p(c,  ...['control_c'].flatMap(() => {
          balanceOffset = randomInt(33);
          sideBias = randomInt(-11,11);
          leftOffset = Math.min(127,Math.max(0, balanceOffset + randomInt(11) + sideBias));
          rightOffset = Math.min(127,Math.max(0, 127 - balanceOffset - randomInt(11) + sideBias));
          centerOffset = Math.min(127,(Math.max(0, 64 + Math.round(v(balanceOffset / 2)) * (Math.random() < 0.5 ? -1 : 1) + sideBias)));
          _ = { tick: beatStart, type: 'control_c' };
          return [
            { ..._, values: [flipBinaural ? leftCH2 : leftCH, 10, leftOffset] },
            { ..._, values: [flipBinaural ? rightCH2 : rightCH, 10, rightOffset] },
            { ..._, values: [centerCH, 10, centerOffset] }
        ];  })  );  }
        divsPerBeat = Math.ceil(composer.setDivisions() * ((numerator / denominator) < 1 ? (numerator / denominator) : 1 / (numerator / denominator)));
        divRhythm = Math.random() < .6 ? 
        composer.setRhythm('euclid', divsPerBeat, closestDivisor(divsPerBeat, Math.ceil(randomFloat(2, divsPerBeat / randomFloat(divsPerBeat / divsPerBeat - randomFloat(1.2)))))) : 
        Math.random < .8 ? composer.setRhythm('euclid', divsPerBeat, closestDivisor(divsPerBeat, randomInt(2,5))) : composer.setRhythm('random',divsPerBeat, v(.9,[-.3,.3],.3));
        ticksPerDiv = ticksPerBeat / Math.max(1, divsPerBeat);
      for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
        divStart = beatStart + divIndex * ticksPerDiv;  c.push(logUnit('division'));
        ({ MIN, MAX, WEIGHTS } = SUBDIVISIONS);
        subdivsPerDiv = r(MIN, MAX, WEIGHTS);
        subdivRhythm = Math.random() < .5 ? 
        composer.setRhythm('euclid', subdivsPerDiv, closestDivisor(subdivsPerDiv, Math.ceil(randomFloat(2, subdivsPerDiv / randomFloat(subdivsPerDiv / subdivsPerDiv - randomFloat(1.2)))))) : 
        Math.random < .9 ? composer.setRhythm('euclid', subdivsPerDiv, closestDivisor(subdivsPerDiv, randomInt(2,5))) : composer.setRhythm('random',subdivsPerDiv, v(.6,[-.3,.3],.3));
        ticksPerSubdiv = ticksPerDiv / Math.max(1, subdivsPerDiv);
        useSubdiv = Math.random() < v(.3, [-.2, .2], .3);
        for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
          subdivStart = divStart + subdivIndex * ticksPerSubdiv;  c.push(logUnit('subdivision'));
          if (beatRhythm[beatIndex] === 1 && divRhythm[divIndex] === 1 && subdivRhythm[subdivIndex] === 1 || beatOffCount > randomInt(1,3)) {
          composer.composeChord().forEach(({ note }) => {  noteCount++;
          if (noteCount % notesUntilRest === 0 || beatCount === randomInt(111) || beatOnCount > randomInt(33,44)) {  beatOnCount = noteCount = notesUntilRest = 0;
          notesUntilRest = randomInt(11, randomInt(66, 111) / Math.min(20, divsPerBeat * subdivsPerDiv));
          } else {  
          on = subdivStart + v(Math.random() * ticksPerSubdiv * .07, [-.07, .07], .3);
          subdivSustain = v(randomFloat(Math.max(ticksPerDiv * .5, ticksPerDiv / subdivsPerDiv), (ticksPerBeat * (.3 + Math.random() * .7))), [.1, .2], [-.05, -.1], .1);
          divSustain = v(randomFloat(ticksPerDiv * .8, (ticksPerBeat * (.3 + Math.random() * .7))), [.1, .3], [-.05, -.1], .1);
          sustain = (useSubdiv ? subdivSustain : divSustain) * v(randomFloat(.9, 1.2));
          binauralVelocity = v(velocity * randomFloat(.33, .44));
          p(c,  ...['C', 'L', 'R'].map(side => [
            { tick: side === 'C' ? on : on + v(ticksPerSubdiv * Math.random() * .1, [-.06, .03], .3), type: 'note_on_c', values: [side === 'C' ? centerCH : (flipBinaural ? (side === 'L' ? leftCH2 : rightCH2) : (side === 'L' ? leftCH : rightCH)), note, side === 'C' ? velocity * randomFloat(.95, 1.05) : binauralVelocity * randomFloat(.97, 1.03)] },
            { tick: on + sustain * (side === 'C' ? 1 : v(randomFloat(.96, 1.01))), values: [side === 'C' ? centerCH : (flipBinaural ? (side === 'L' ? leftCH2 : rightCH2) : (side === 'L' ? leftCH : rightCH)), note] }
          ]).flat()  );
        }
          });
        }}
      }
    }
    currentTick += ticksPerMeasure;  currentTime += secondsPerMeasure;
  }
  c = c.filter(item => item !== null).sort((a, b) => a.tick - b.tick);  c.forEach(_ => {
    composition += `1, ${_.tick || 0}, ${_.type || 'note_off_c'}, ${_.values.join(', ')}\n`;
    finalTick = _.tick;
  });
  composition += finale();  fs.writeFileSync('output.csv', composition);
  console.log('output.csv created. Track Length:', finalTime);
})();
