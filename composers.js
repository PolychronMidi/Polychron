class MeasureComposer {
  getMeter() {const {min:a,max:b,weights:c}=NUMERATOR; const {min:x,max:y,weights:z}=DENOMINATOR; return [ rw(a,b,c),rw(x,y,z) ]; }
  getDivisions() {const { min,max,weights }=DIVISIONS; return rw(min,max,weights);}
  getSubdivisions() {const { min,max,weights }=SUBDIVISIONS; return rw(min,max,weights);}
  getOctaveRange() {
    const { min,max,weights } = OCTAVE;
    let [o1,o2] = [rw(min,max,weights),rw(min,max,weights)];
    while (o1===o2) {  o2 = m.max(min,m.min(max,o2 + ri(-3,3)));  }
    return [ o1,o2 ];
  }
  getVoices() {
    const { min,max,weights } = VOICES;
    const v = m.min(rw(min,max,weights),this.notes.length * 4);
    return subdivFreq > ri(100,150) ? m.max(1,m.floor(v / ri(2,3))) : v;
  }
  getNotes(octaveRange = null) {
    const voices = this.getVoices();
    const uniqueNotes = new Set();
    const [minOctave,maxOctave] = octaveRange || this.getOctaveRange();
    const rootNote = this.notes[ri(this.notes.length - 1)];
    let intervals = [],fallback = false;
    try {  const shift=ri(1);
      switch (ri(2)) {
        case 0:intervals=[0,2,3+shift,6-shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1));  break;
        case 1:intervals=[0,1,3+shift,5+shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1));  break;
        default:intervals=Array.from({length:this.notes.length},(_,i)=>i);  fallback=true;  }
      return intervals.slice(0,voices).map((interval,index)=>{
        const noteIndex=(this.notes.indexOf(rootNote)+interval) % this.notes.length;
        let octave=ri(minOctave,maxOctave);
        let note=t.Note.chroma(this.notes[noteIndex])+12*octave;
        while (uniqueNotes.has(note)) {
          octave = octave < maxOctave ? octave++ : octave > minOctave ? octave-- : octave < OCTAVE.max ? octave++ : octave > OCTAVE.min ? octave-- : (()=>{ return false; })();
          if (octave===false) break; note=t.Note.chroma(this.notes[noteIndex])+12*octave;  }
        return { note };
      }).filter((noteObj,index,self) => 
        index===self.findIndex(n => n.note===noteObj.note)
      ); }  catch (e) { if (!fallback) { return this.getNotes(octaveRange); } else {
      console.warn(e.message);  return this.getNotes(octaveRange);  }}}
}
class ScaleComposer extends MeasureComposer {
  constructor(scaleName,root) { 
    super(); 
    this.root = root; 
    this.noteSet(scaleName,root);  
  }
  noteSet(scaleName,root) {
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }
  x=()=>this.getNotes();
}
class RandomScaleComposer extends ScaleComposer {
  constructor() { 
    super('','');  
    this.noteSet();  
  }
  noteSet() {
    const randomScale = allScales[ri(allScales.length - 1)];
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomScale,randomRoot);
  }
  x=()=>{ this.noteSet(); return super.x(); }
}
class ChordComposer extends MeasureComposer {
  constructor(progression) { 
    super();  
    this.noteSet(progression,'R');
  }
  noteSet(progression,direction = 'R') {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!allChords.includes(chordSymbol)) { console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;  }  return true;  });
    if (validatedProgression.length===0) {console.warn('No valid chords in progression');
    } else {
      this.progression = validatedProgression.map(t.Chord.get); 
      this.currentChordIndex = this.currentChordIndex || 0;
      let next
      switch (direction.toUpperCase()) {
        case 'R': next = 1; break;
        case 'L': next = -1; break;
        case 'E': next = m.random() < .5 ? 1 : -1; break;
        case '?': next = ri(-2,2); break;
        default:console.warn('Invalid direction, defaulting to right'); next=1;
      }
      let progressChord=beatCount % m.floor(meterRatio / 3) < 1;
      if (progressChord) { allNotesOff(subdivStart); }
      this.currentChordIndex +=  progressChord ? next % (this.progression.length) : 0;
      this.currentChordIndex=(this.currentChordIndex+this.progression.length)%this.progression.length;
      this.notes = this.progression[this.currentChordIndex].notes;
    }
  }
  x=()=>this.getNotes();
}
class RandomChordComposer extends ChordComposer {
  constructor() { 
    super([]);  
    this.noteSet();  
  }
  noteSet() {
    const progressionLength = ri(1,5);
    const randomProgression = [];
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = allChords[ri(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    super.noteSet(randomProgression,'?');
  }
  x=()=>{ this.noteSet(); return super.x(); }
}
class ModeComposer extends MeasureComposer {
  constructor(modeName,root) { 
    super(); 
    this.root = root; 
    this.noteSet(modeName,root);  
  }
  noteSet(modeName,root) {
    this.mode = t.Mode.get(modeName);
    this.notes = t.Mode.notes(this.mode,root);
  }
  x=()=>this.getNotes();
}
class RandomModeComposer extends ModeComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  noteSet() {
    const randomMode = allModes[ri(allModes.length - 1)];
    const [root,modeName] = randomMode.split(' ');
    this.root = root; 
    super.noteSet(modeName,root);    
  }
  x=()=>{ this.noteSet(); return super.x(); }
}
composers=(function() {  return COMPOSERS.map(composer=>
  eval(`(function() { return ${composer.return}; }).call({name:'${composer.name || ''}',root:'${composer.root || ''}',progression:${JSON.stringify(composer.progression || [])}})`) ); })();
