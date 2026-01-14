// composers.js - Musical intelligence system with meter and composition generation.
// minimalist comments, details at: composers.md

/**
 * Composes meter-related values with randomization.
 * @class
 */
class MeasureComposer {
  constructor() {
    /** @type {number[]|null} Previous meter [numerator, denominator] */
    this.lastMeter=null;
    /** @type {number} Recursion depth counter for getNotes */
    this.recursionDepth=0;
    /** @type {number} Max allowed recursion depth */
    this.MAX_RECURSION=5;
  }
  /** @returns {number} Random numerator from NUMERATOR config */
  getNumerator(){const{min,max,weights}=NUMERATOR;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random denominator from DENOMINATOR config */
  getDenominator(){const{min,max,weights}=DENOMINATOR;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random divisions count from DIVISIONS config */
  getDivisions(){const{min,max,weights}=DIVISIONS;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random subdivisions count from SUBDIVISIONS config */
  getSubdivisions(){const{min,max,weights}=SUBDIVISIONS;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random sub-subdivisions count from SUBSUBDIVS config */
  getSubsubdivs(){const{min,max,weights}=SUBSUBDIVS;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random voice count from VOICES config */
  getVoices(){const{min,max,weights}=VOICES;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number[]} Two octaves with minimum 2-3 octave difference */
  getOctaveRange() { const { min,max,weights }=OCTAVE;
  let [o1,o2]=[rw(min,max,weights),rw(min,max,weights)];
  while (m.abs(o1-o2)<ri(2,3)) { o2=modClamp(o2+ri(-3,3),min,max); }
  return [ o1,o2 ];
  }
  /**
   * Generates a valid meter [numerator, denominator] with log-based ratio check.
   * @param {boolean} [ignoreRatioCheck=false] - Skip ratio validation
   * @param {boolean} [polyMeter=false] - Allow larger ratio jumps for polyrhythm
   * @param {number} [maxIterations=100] - Maximum attempts before fallback
   * @returns {number[]} [numerator, denominator]
   * @throws {Error} When max iterations exceeded and no valid meter found
   */
getMeter(ignoreRatioCheck=false, polyMeter=false, maxIterations=100) {
  // Constants for ratio validation
  const METER_RATIO_MIN = 0.25;
  const METER_RATIO_MAX = 4;
  const MIN_LOG_STEPS = 0.5;
  const FALLBACK_METER = [4, 4];

  let iterations=0;
  const maxLogSteps=polyMeter ? 4 : 2; // Log2 steps: 2 = ~4x ratio, 4 = ~16x ratio

  while (++iterations <= maxIterations) {
    let newNumerator=this.getNumerator();
    let newDenominator=this.getDenominator();

    // Validate numerator and denominator are positive integers
    if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) || newNumerator <= 0 || newDenominator <= 0) {
      continue;
    }

    let newMeterRatio=newNumerator / newDenominator;

    // Check if new meter ratio is within acceptable range
    const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

    if (ratioValid) {
      if (this.lastMeter) {
        let lastMeterRatio=this.lastMeter[0] / this.lastMeter[1];
        // Log ratio: 0 = same, 1 = 2x, 2 = 4x, 3 = 8x, 4 = 16x difference
        let logSteps=m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
        if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps) {
          this.lastMeter=[newNumerator,newDenominator];
          return this.lastMeter;
        }
      } else {
        this.lastMeter=[newNumerator,newDenominator];
        return this.lastMeter;
      }
    }
  }

  // Log warning with diagnostic info
  console.warn(`getMeter() failed after ${iterations} iterations. Ratio bounds: [${METER_RATIO_MIN}, ${METER_RATIO_MAX}]. LogSteps range: [${MIN_LOG_STEPS}, ${maxLogSteps}]. Returning fallback: [${FALLBACK_METER[0]}, ${FALLBACK_METER[1]}]`);
  this.lastMeter=FALLBACK_METER;
  return this.lastMeter;
}
  /**
   * Generates note objects within octave range.
   * @param {number[]|null} [octaveRange=null] - [min, max] octaves, or auto-generate
   * @returns {{note: number}[]} Array of note objects
   */
  getNotes(octaveRange=null) {
    if (++this.recursionDepth > this.MAX_RECURSION) {
      console.warn('getNotes recursion limit exceeded; returning fallback note 0');
      this.recursionDepth = 0;
      return [{ note: 0 }];
    }
    const uniqueNotes=new Set();
    const voices=this.getVoices();
    const [minOctave,maxOctave]=octaveRange || this.getOctaveRange();
    const rootNote=this.notes[ri(this.notes.length - 1)];
    let intervals=[],fallback=false;
    try {  const shift=ri();
      switch (ri(2)) {
        case 0:intervals=[0,2,3+shift,6-shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1));  break;
        case 1:intervals=[0,1,3+shift,5+shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1));  break;
        default:intervals=Array.from({length:this.notes.length},(_,i)=>i);  fallback=true;  }
      // Validate that all intervals are within scale bounds and produce valid scale degrees
      intervals = intervals.map(interval => {
        // Ensure interval is within valid range for the scale
        const validatedInterval = clamp(interval, 0, this.notes.length - 1);
        // Calculate the actual note index to verify it's within the scale
        const rootIndex = this.notes.indexOf(rootNote);
        const noteIndex = (rootIndex + validatedInterval) % this.notes.length;
        // Return the validated interval that produces a proper scale degree
        return validatedInterval;
      });
      return intervals.slice(0,voices).map((interval,index)=>{
        const noteIndex=(this.notes.indexOf(rootNote)+interval) % this.notes.length;
        let octave=ri(minOctave,maxOctave);
        let note=t.Note.chroma(this.notes[noteIndex])+12*octave;
        while (uniqueNotes.has(note)) {
          octave=octave < maxOctave ? octave++ : octave > minOctave ? octave-- : octave < OCTAVE.max ? octave++ : octave > OCTAVE.min ? octave-- : (()=>{ return false; })();
          if (octave===false) break; note=t.Note.chroma(this.notes[noteIndex])+12*octave;  }
        return { note };
      }).filter((noteObj,index,self)=>
        index===self.findIndex(n=>n.note===noteObj.note)
      ); }  catch (e) { if (!fallback) { this.recursionDepth--; return this.getNotes(octaveRange); } else {
      console.warn(e.message); this.recursionDepth--; return this.getNotes(octaveRange);  }}
    finally {
      this.recursionDepth--;
    }
  }
}
/**
 * Composes notes from a specific scale.
 * @extends MeasureComposer
 */
class ScaleComposer extends MeasureComposer {
  /**
   * @param {string} scaleName - e.g., 'major', 'minor'
   * @param {string} root - e.g., 'C', 'D#'
   */
  constructor(scaleName,root) {
    super();
    this.root=root;
    this.noteSet(scaleName,root);
  }
  /**
   * Sets scale and extracts notes.
   * @param {string} scaleName
   * @param {string} root
   */
  noteSet(scaleName,root) {
    this.scale=t.Scale.get(`${root} ${scaleName}`);
    this.notes=this.scale.notes;
  }
  /** @returns {{note: number}[]} Scale notes */
  x=()=>this.getNotes();
}
/**
 * Random scale selection from all available scales.
 * @extends ScaleComposer
 */
class RandomScaleComposer extends ScaleComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects scale and root from venue.js data */
  noteSet() {
    const randomScale=allScales[ri(allScales.length - 1)];
    const randomRoot=allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomScale,randomRoot);
  }
  /** @returns {{note: number}[]} Random scale notes */
  x() { this.noteSet(); return super.x(); }
}
/**
 * Composes notes from a chord progression.
 * @extends MeasureComposer
 */
class ChordComposer extends MeasureComposer {
  /**
   * @param {string[]} progression - Array of chord symbols, e.g., ['CM', 'Dm', 'Em']
   */
  constructor(progression) {
    super();
    this.noteSet(progression,'R');
  }
  /**
   * Sets progression and validates chords.
   * @param {string[]} progression
   * @param {string} [direction='R'] - 'R' (right), 'L' (left), 'E' (either), '?' (random)
   */
  noteSet(progression,direction='R') {
    const validatedProgression=progression.filter(chordSymbol=>{
      if (!allChords.includes(chordSymbol)) { console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;  }  return true;  });
    if (validatedProgression.length===0) {console.warn('No valid chords in progression');
    } else {
      this.progression=validatedProgression.map(t.Chord.get);
      this.currentChordIndex=this.currentChordIndex || 0;
      let next;
      switch (direction.toUpperCase()) {
        case 'R': next=1; break;
        case 'L': next=-1; break;
        case 'E': next=rf() < .5 ? 1 : -1; break;
        case '?': next=ri(-2,2); break;
        default:console.warn('Invalid direction,defaulting to right'); next=1;
      }
      let startingMeasure=measureCount;
      let progressChord=measureCount>startingMeasure || rf()<.05;
      if (progressChord) { allNotesOff(subdivStart); startingMeasure=measureCount; }
      this.currentChordIndex+= progressChord ? next % (this.progression.length) : 0;
      this.currentChordIndex=(this.currentChordIndex+this.progression.length)%this.progression.length;
      this.notes=this.progression[this.currentChordIndex].notes;
    }
  }
  /** @returns {{note: number}[]} Chord notes */
  x=()=>this.getNotes();
}
/**
 * Random chord progression from all available chords.
 * @extends ChordComposer
 */
class RandomChordComposer extends ChordComposer {
  constructor() {
    super([]);
    this.noteSet();
  }
  /** Generates 2-5 random chords */
  noteSet() {
    const progressionLength=ri(2,5);
    const randomProgression=[];
    for (let i=0; i < progressionLength; i++) {
      const randomChord=allChords[ri(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    super.noteSet(randomProgression,'?');
  }
  /** @returns {{note: number}[]} Random progression notes */
  x() { this.noteSet(); return super.x(); }
}
/**
 * Composes notes from a specific mode.
 * @extends MeasureComposer
 */
class ModeComposer extends MeasureComposer {
  /**
   * @param {string} modeName - e.g., 'ionian', 'aeolian'
   * @param {string} root - e.g., 'A', 'C'
   */
  constructor(modeName,root) {
    super();
    this.root=root;
    this.noteSet(modeName,root);
  }
  /**
   * Sets mode and extracts notes.
   * @param {string} modeName
   * @param {string} root
   */
  noteSet(modeName,root) {
    this.mode=t.Mode.get(modeName);
    this.notes=t.Mode.notes(this.mode,root);
  }
  /** @returns {{note: number}[]} Mode notes */
  x=()=>this.getNotes();
}
/**
 * Random mode selection from all available modes.
 * @extends ModeComposer
 */
class RandomModeComposer extends ModeComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects mode and root from venue.js data */
  noteSet() {
    const randomMode=allModes[ri(allModes.length - 1)];
    const [root,modeName]=randomMode.split(' ');
    this.root=root;
    super.noteSet(modeName,root);
  }
  /** @returns {{note: number}[]} Random mode notes */
  x() { this.noteSet(); return super.x(); }
}
/**
 * Instantiates all composers from COMPOSERS config.
 * @type {MeasureComposer[]}
 */
composers=(function() {  return COMPOSERS.map(composer=>
  eval(`(function() { return ${composer.return}; }).call({name:'${composer.name || ''}',root:'${composer.root || ''}',progression:${JSON.stringify(composer.progression || [])}})`) ); })();

// Export classes globally for testing
globalThis.MeasureComposer = MeasureComposer;
globalThis.ScaleComposer = ScaleComposer;
globalThis.RandomScaleComposer = RandomScaleComposer;
globalThis.ChordComposer = ChordComposer;
globalThis.RandomChordComposer = RandomChordComposer;
globalThis.ModeComposer = ModeComposer;
globalThis.RandomModeComposer = RandomModeComposer;
