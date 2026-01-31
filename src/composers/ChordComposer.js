require('./MeasureComposer');

function normalizeChordSymbol(chordSymbol) {
  const enharmonicMap = {
    'B#': 'C', 'E#': 'F', 'Cb': 'B', 'Fb': 'E',
    'Bb#': 'B', 'Eb#': 'E', 'Ab#': 'A', 'Db#': 'D', 'Gb#': 'G',
    'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'
  };

  let normalized = chordSymbol;

  for (const [from, to] of Object.entries(enharmonicMap).sort((a, b) => b[0].length - a[0].length)) {
    if (normalized.startsWith(from)) {
      normalized = to + normalized.slice(from.length);
      break;
    }
  }

  return normalized;
}

ChordComposer = class ChordComposer extends MeasureComposer {
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
    const validatedProgression=progression.map(normalizeChordSymbol).filter(chordSymbol=>{
      const chord = t.Chord.get(chordSymbol);
      if (chord.empty) {
        console.warn(`ChordComposer.noteSet: invalid chord symbol "${chordSymbol}"`);
        return false;
      }
      return true;
    });
    if (validatedProgression.length===0) { throw new Error('ChordComposer.noteSet: no valid chords');
    } else {
      this.progression=validatedProgression.map(t.Chord.get);
      this.currentChordIndex=this.currentChordIndex || 0;
      let next;
      switch (direction.toUpperCase()) {
        case 'R': next=1; break;
        case 'L': next=-1; break;
        case 'E': next=rf() < .5 ? 1 : -1; break;
        case '?': next=ri(-2,2); break;
        default: console.warn(`ChordComposer.noteSet: invalid direction "${direction}", defaulting to right`); next=1;
      }
      let startingMeasure=measureCount;
      let progressChord=measureCount>startingMeasure || rf()<.05;
      if (progressChord && typeof subdivStart !== 'undefined') { allNotesOff(subdivStart); startingMeasure=measureCount; }
      this.currentChordIndex+= progressChord ? next % (this.progression.length) : 0;
      this.currentChordIndex=(this.currentChordIndex+this.progression.length)%this.progression.length;
      this.notes=this.progression[this.currentChordIndex].notes;
    }
  }
  /** @returns {{note: number}[]} Chord notes */
  x=()=>this.getNotes();
}

RandomChordComposer = class RandomChordComposer extends ChordComposer {
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
    super.noteSet(randomProgression);
  }
}

/* ChordComposer and RandomChordComposer exposed via require side-effects */
