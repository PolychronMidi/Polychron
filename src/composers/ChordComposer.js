require('./MeasureComposer');
require('./VoiceLeadingScore');

function normalizeChordSymbol(chordSymbol) {
  // Accept chord objects like { symbol: 'Cmaj7' } or raw strings
  if (typeof chordSymbol !== 'string') {
    if (chordSymbol && typeof chordSymbol === 'object' && typeof chordSymbol.symbol === 'string') {
      chordSymbol = chordSymbol.symbol;
    } else return chordSymbol;
  }
  const enharmonicMap = {
    'B#': 'C', 'E#': 'F', 'Cb': 'B', 'Fb': 'E',
    'Bb#': 'B', 'Eb#': 'E', 'Ab#': 'A', 'Db#': 'D', 'Gb#': 'G',
    'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'
  };

  // Normalize Unicode sharps/flats to ASCII and trim
  let normalized = chordSymbol.replace(/[♯♭]/g, ch => ch === '♯' ? '#' : 'b').trim();

  // Split off a slash-bass if present so we can normalize both parts
  const parts = normalized.split('/');
  let main = parts[0] || '';
  let bass = parts[1] || '';

  // Normalize a single note/root string: remove cancelling accidental pairs and uppercase root
  const normalizeRoot = (str) => {
    const rootMatch = String(str).match(/^([A-Ga-g][#b]*)(.*)$/);
    if (!rootMatch) return str;
    const rawRoot = rootMatch[1];
    const rest = rootMatch[2] || '';
    const cleanedRoot = rawRoot.replace(/(#b|b#)+/g, '');
    let out = cleanedRoot + rest;
    // Capitalize the root letter for tonal compatibility
    out = out.replace(/^([a-g])/, ch => ch.toUpperCase());

    // Apply enharmonic map to the root if it matches any 'from' patterns
    for (const [from, to] of Object.entries(enharmonicMap).sort((a, b) => b[0].length - a[0].length)) {
      if (out.startsWith(from)) {
        out = to + out.slice(from.length);
        break;
      }
    }
    return out;
  };

  // Normalize main and bass parts
  main = normalizeRoot(main);
  if (bass) bass = normalizeRoot(bass);
  normalized = bass ? `${main}/${bass}` : main;

  return normalized;
}

ChordComposer = class ChordComposer extends MeasureComposer {
  /**
   * @param {string[]} progression - Array of chord symbols, e.g., ['CM', 'Dm', 'Em']
   */
  constructor(progression) {
    super();
    // enable basic voice-leading scorer to allow selectNoteWithLeading delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('ChordComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
    this.noteSet(progression,'R');
  }

  /**
   * Select a candidate using composer-local voice-leading if available.
   * Delegates to VoiceLeadingScore.selectNextNote when enabled.
   * @param {number[]} candidates
   * @returns {number}
   */
  selectNoteWithLeading(candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) return candidates[0];
    try {
      if (this.VoiceLeadingScore && typeof this.VoiceLeadingScore.selectNextNote === 'function') {
        const lastNotes = Array.isArray(this.voiceHistory) ? this.voiceHistory : [];
        return this.VoiceLeadingScore.selectNextNote(lastNotes, candidates, {});
      }
    } catch (e) { console.warn('ChordComposer: scoring failed, falling back to deterministic behavior:', e && e.stack ? e.stack : e); }
    return candidates[0];
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
