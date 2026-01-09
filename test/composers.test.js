// test/composers.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

let m = Math;
let bpmRatio = 1;
let measureCount = 0;
let subdivStart = 0;

// Mock configuration objects
const NUMERATOR = { min: 2, max: 9, weights: [1, 2, 3, 4, 5, 4, 3, 2] };
const DENOMINATOR = { min: 2, max: 9, weights: [1, 2, 3, 4, 5, 4, 3, 2] };
const DIVISIONS = { min: 1, max: 8, weights: [5, 4, 3, 2, 1, 1, 1, 1] };
const SUBDIVISIONS = { min: 1, max: 8, weights: [5, 4, 3, 2, 1, 1, 1, 1] };
const SUBSUBDIVS = { min: 1, max: 8, weights: [5, 4, 3, 2, 1, 1, 1, 1] };
const VOICES = { min: 1, max: 8, weights: [5, 4, 3, 2, 1, 1, 1, 1] };
const OCTAVE = { min: 2, max: 6, weights: [1, 2, 3, 2, 1] };

// Mock Tonal.js
const mockTonal = {
  Scale: {
    get: vi.fn((name) => ({
      name: name,
      notes: ['C', 'D', 'E', 'F', 'G', 'A', 'B']
    }))
  },
  Chord: {
    get: vi.fn((symbol) => ({
      symbol: symbol,
      notes: ['C', 'E', 'G']
    }))
  },
  Mode: {
    get: vi.fn((name) => ({
      name: name
    })),
    notes: vi.fn((mode, root) => ['C', 'D', 'E', 'F', 'G', 'A', 'B'])
  },
  Note: {
    chroma: vi.fn((note) => {
      const chromaMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
      return chromaMap[note] || 0;
    })
  }
};

const t = mockTonal;

const allScales = ['major', 'minor', 'dorian', 'phrygian', 'lydian'];
const allNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const allChords = ['C', 'Dm', 'Em', 'F', 'G', 'Am'];
const allModes = ['C ionian', 'D dorian', 'E phrygian'];

// Helper functions
const rf = (min1 = 1, max1) => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  return Math.random() * (max1 - min1) + min1;
};

const ri = (min1 = 1, max1) => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  return Math.round(Math.random() * (max1 - min1) + min1);
};

const clamp = (value, min, max) => m.min(m.max(value, min), max);

const modClamp = (value, min, max) => {
  const range = max - min + 1;
  return ((value - min) % range + range) % range + min;
};

const scaleBoundClamp = (value, base, lowerScale, upperScale, minBound = 2, maxBound = 9) => {
  const lowerBound = m.max(minBound, m.floor(base * lowerScale));
  const upperBound = m.min(maxBound, m.ceil(base * upperScale));
  return clamp(value, lowerBound, upperBound);
};

const rw = (min, max, weights) => {
  const random = Math.random();
  let cumulative = 0;
  const total = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i] / total;
    if (random <= cumulative) return i + min;
  }
  return max;
};

const allNotesOff = vi.fn();

// Setup function
function setupGlobalState() {
  bpmRatio = 1;
  measureCount = 0;
  subdivStart = 0;
  m = Math;
}

// Composer classes
class MeasureComposer {
  constructor() {
    this.lastMeter = null;
  }
  getNumerator() { const { min, max, weights } = NUMERATOR; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
  getDenominator() { const { min, max, weights } = DENOMINATOR; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
  getDivisions() { const { min, max, weights } = DIVISIONS; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
  getSubdivisions() { const { min, max, weights } = SUBDIVISIONS; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
  getSubsubdivs() { const { min, max, weights } = SUBSUBDIVS; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
  getVoices() { const { min, max, weights } = VOICES; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
  getOctaveRange() {
    const { min, max, weights } = OCTAVE;
    let [o1, o2] = [rw(min, max, weights), rw(min, max, weights)];
    while (m.abs(o1 - o2) < ri(2, 3)) { o2 = modClamp(o2 + ri(-3, 3), min, max); }
    return [o1, o2];
  }
  getMeter(ignoreRatioCheck = false, polyMeter = false) {
    let iterations = 0;
    while (iterations < 100) {
      iterations++;
      let newNumerator = this.getNumerator();
      let newDenominator = this.getDenominator();
      let newMeterRatio = newNumerator / newDenominator;
      if (ignoreRatioCheck || (newMeterRatio >= 0.3 && newMeterRatio <= 3)) {
        if (this.lastMeter && !ignoreRatioCheck) {
          let lastMeterRatio = this.lastMeter[0] / this.lastMeter[1];
          let ratioChange = m.abs(newMeterRatio - lastMeterRatio);
          if (ratioChange <= 0.75) {
            this.lastMeter = [newNumerator, newDenominator];
            return this.lastMeter;
          }
        } else {
          this.lastMeter = [newNumerator, newDenominator];
          return this.lastMeter;
        }
      }
    }
    return [4, 4]; // Fallback
  }
  getNotes(octaveRange = null) {
    const uniqueNotes = new Set();
    const voices = this.getVoices();
    const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    const rootNote = this.notes[ri(this.notes.length - 1)];
    let intervals = [], fallback = false;
    try {
      const shift = ri();
      switch (ri(2)) {
        case 0: intervals = [0, 2, 3 + shift, 6 - shift].map(interval => clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1)); break;
        case 1: intervals = [0, 1, 3 + shift, 5 + shift].map(interval => clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1)); break;
        default: intervals = Array.from({ length: this.notes.length }, (_, i) => i); fallback = true;
      }
      return intervals.slice(0, voices).map((interval, index) => {
        const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
        let octave = ri(minOctave, maxOctave);
        let note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
        while (uniqueNotes.has(note)) {
          octave = octave < maxOctave ? octave++ : octave > minOctave ? octave-- : octave < OCTAVE.max ? octave++ : octave > OCTAVE.min ? octave-- : (() => { return false; })();
          if (octave === false) break; note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
        }
        return { note };
      }).filter((noteObj, index, self) =>
        index === self.findIndex(n => n.note === noteObj.note)
      );
    } catch (e) {
      if (!fallback) { return this.getNotes(octaveRange); } else {
        console.warn(e.message); return this.getNotes(octaveRange);
      }
    }
  }
}

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
  x() { return this.getNotes(); }
}

class RandomScaleComposer extends ScaleComposer {
  constructor() {
    super('', '');
    this.noteSet();
  }
  noteSet() {
    const randomScale = allScales[ri(allScales.length - 1)];
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomScale, randomRoot);
  }
  x() { this.noteSet(); return this.getNotes(); }
}

class ChordComposer extends MeasureComposer {
  constructor(progression) {
    super();
    this.noteSet(progression, 'R');
  }
  noteSet(progression, direction = 'R') {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!allChords.includes(chordSymbol)) {
        console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;
      } return true;
    });
    if (validatedProgression.length === 0) { console.warn('No valid chords in progression'); }
    else {
      this.progression = validatedProgression.map(t.Chord.get);
      this.currentChordIndex = this.currentChordIndex || 0;
      let next;
      switch (direction.toUpperCase()) {
        case 'R': next = 1; break;
        case 'L': next = -1; break;
        case 'E': next = rf() < .5 ? 1 : -1; break;
        case '?': next = ri(-2, 2); break;
        default: console.warn('Invalid direction,defaulting to right'); next = 1;
      }
      let startingMeasure = measureCount;
      let progressChord = measureCount > startingMeasure || rf() < .05;
      if (progressChord) { allNotesOff(subdivStart); startingMeasure = measureCount; }
      this.currentChordIndex += progressChord ? next % (this.progression.length) : 0;
      this.currentChordIndex = (this.currentChordIndex + this.progression.length) % this.progression.length;
      this.notes = this.progression[this.currentChordIndex].notes;
    }
  }
  x() { return this.getNotes(); }
}

class RandomChordComposer extends ChordComposer {
  constructor() {
    super([]);
    this.noteSet();
  }
  noteSet() {
    const progressionLength = ri(2, 5);
    const randomProgression = [];
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = allChords[ri(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    super.noteSet(randomProgression, '?');
  }
  x() { this.noteSet(); return this.getNotes(); }
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
  x() { return this.getNotes(); }
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
  x() { this.noteSet(); return this.getNotes(); }
}

describe('MeasureComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  describe('constructor', () => {
    it('should initialize with null lastMeter', () => {
      const composer = new MeasureComposer();
      expect(composer.lastMeter).toBeNull();
    });
  });

  describe('getNumerator', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getNumerator();
      expect(result).toBeGreaterThanOrEqual(NUMERATOR.min);
      expect(result).toBeLessThanOrEqual(NUMERATOR.max);
    });

    it('should return an integer', () => {
      const composer = new MeasureComposer();
      const result = composer.getNumerator();
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('getDenominator', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getDenominator();
      expect(result).toBeGreaterThanOrEqual(DENOMINATOR.min);
      expect(result).toBeLessThanOrEqual(DENOMINATOR.max);
    });
  });

  describe('getDivisions', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getDivisions();
      expect(result).toBeGreaterThanOrEqual(DIVISIONS.min);
      expect(result).toBeLessThanOrEqual(DIVISIONS.max);
    });
  });

  describe('getSubdivisions', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getSubdivisions();
      expect(result).toBeGreaterThanOrEqual(SUBDIVISIONS.min);
      expect(result).toBeLessThanOrEqual(SUBDIVISIONS.max);
    });
  });

  describe('getSubsubdivs', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getSubsubdivs();
      expect(result).toBeGreaterThanOrEqual(SUBSUBDIVS.min);
      expect(result).toBeLessThanOrEqual(SUBSUBDIVS.max);
    });
  });

  describe('getVoices', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getVoices();
      expect(result).toBeGreaterThanOrEqual(VOICES.min);
      expect(result).toBeLessThanOrEqual(VOICES.max);
    });
  });

  describe('getOctaveRange', () => {
    it('should return an array of two octaves', () => {
      const composer = new MeasureComposer();
      const result = composer.getOctaveRange();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should return octaves within configured range', () => {
      const composer = new MeasureComposer();
      const [o1, o2] = composer.getOctaveRange();
      expect(o1).toBeGreaterThanOrEqual(OCTAVE.min);
      expect(o1).toBeLessThanOrEqual(OCTAVE.max);
      expect(o2).toBeGreaterThanOrEqual(OCTAVE.min);
      expect(o2).toBeLessThanOrEqual(OCTAVE.max);
    });

    it('should ensure octaves are at least 2-3 apart', () => {
      const composer = new MeasureComposer();
      const [o1, o2] = composer.getOctaveRange();
      expect(Math.abs(o1 - o2)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getMeter', () => {
    it('should return an array of two numbers', () => {
      const composer = new MeasureComposer();
      const result = composer.getMeter();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should return valid meter ratio when not ignoring check', () => {
      const composer = new MeasureComposer();
      const [num, den] = composer.getMeter(false);
      const ratio = num / den;
      expect(ratio).toBeGreaterThanOrEqual(0.3);
      expect(ratio).toBeLessThanOrEqual(3);
    });

    it('should store lastMeter', () => {
      const composer = new MeasureComposer();
      const meter = composer.getMeter();
      expect(composer.lastMeter).toEqual(meter);
    });

    it('should limit ratio change when lastMeter exists', () => {
      const composer = new MeasureComposer();
      const firstMeter = composer.getMeter();
      const secondMeter = composer.getMeter();
      const ratio1 = firstMeter[0] / firstMeter[1];
      const ratio2 = secondMeter[0] / secondMeter[1];
      const change = Math.abs(ratio1 - ratio2);
      expect(change).toBeLessThanOrEqual(0.75);
    });

    it('should allow any meter when ignoring ratio check', () => {
      const composer = new MeasureComposer();
      const result = composer.getMeter(true);
      expect(result.length).toBe(2);
    });
  });
});

describe('ScaleComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should initialize with scale and root', () => {
    const composer = new ScaleComposer('major', 'C');
    expect(composer.root).toBe('C');
    expect(composer.scale).toBeDefined();
    expect(composer.notes).toBeDefined();
  });

  it('should call Tonal Scale.get', () => {
    mockTonal.Scale.get.mockClear();
    new ScaleComposer('major', 'C');
    expect(mockTonal.Scale.get).toHaveBeenCalledWith('C major');
  });

  it('should have notes array', () => {
    const composer = new ScaleComposer('major', 'C');
    expect(Array.isArray(composer.notes)).toBe(true);
    expect(composer.notes.length).toBeGreaterThan(0);
  });

  it('should have x method that returns notes', () => {
    const composer = new ScaleComposer('major', 'C');
    const result = composer.x();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('RandomScaleComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should initialize with random scale', () => {
    const composer = new RandomScaleComposer();
    expect(composer.scale).toBeDefined();
    expect(composer.root).toBeDefined();
  });

  it('should generate new scale on each x() call', () => {
    const composer = new RandomScaleComposer();
    const result1 = composer.x();
    const result2 = composer.x();
    expect(Array.isArray(result1)).toBe(true);
    expect(Array.isArray(result2)).toBe(true);
  });
});

describe('ChordComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should initialize with progression', () => {
    const composer = new ChordComposer(['C', 'F', 'G']);
    expect(composer.progression).toBeDefined();
    expect(composer.notes).toBeDefined();
  });

  it('should filter invalid chords', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composer = new ChordComposer(['C', 'InvalidChord', 'F']);
    expect(composer.progression.length).toBeLessThan(3);
    vi.restoreAllMocks();
  });

  it('should track current chord index', () => {
    const composer = new ChordComposer(['C', 'F', 'G']);
    expect(composer.currentChordIndex).toBeDefined();
    expect(composer.currentChordIndex).toBeGreaterThanOrEqual(0);
  });

  it('should handle direction R (right)', () => {
    const composer = new ChordComposer(['C', 'F', 'G']);
    composer.noteSet(['C', 'F', 'G'], 'R');
    expect(composer.currentChordIndex).toBeGreaterThanOrEqual(0);
  });

  it('should handle direction L (left)', () => {
    const composer = new ChordComposer(['C', 'F', 'G']);
    composer.noteSet(['C', 'F', 'G'], 'L');
    expect(composer.currentChordIndex).toBeGreaterThanOrEqual(0);
  });
});

describe('RandomChordComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should initialize with random progression', () => {
    const composer = new RandomChordComposer();
    expect(composer.progression).toBeDefined();
    expect(composer.progression.length).toBeGreaterThanOrEqual(2);
    expect(composer.progression.length).toBeLessThanOrEqual(5);
  });

  it('should generate new progression on each x() call', () => {
    const composer = new RandomChordComposer();
    const result1 = composer.x();
    const result2 = composer.x();
    expect(Array.isArray(result1)).toBe(true);
    expect(Array.isArray(result2)).toBe(true);
  });
});

describe('ModeComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should initialize with mode and root', () => {
    const composer = new ModeComposer('ionian', 'C');
    expect(composer.root).toBe('C');
    expect(composer.mode).toBeDefined();
    expect(composer.notes).toBeDefined();
  });

  it('should call Tonal Mode methods', () => {
    mockTonal.Mode.get.mockClear();
    mockTonal.Mode.notes.mockClear();
    new ModeComposer('ionian', 'C');
    expect(mockTonal.Mode.get).toHaveBeenCalledWith('ionian');
    expect(mockTonal.Mode.notes).toHaveBeenCalled();
  });
});

describe('RandomModeComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should initialize with random mode', () => {
    const composer = new RandomModeComposer();
    expect(composer.mode).toBeDefined();
    expect(composer.root).toBeDefined();
  });

  it('should generate new mode on each x() call', () => {
    const composer = new RandomModeComposer();
    const result1 = composer.x();
    const result2 = composer.x();
    expect(Array.isArray(result1)).toBe(true);
    expect(Array.isArray(result2)).toBe(true);
  });
});

describe('getNotes integration', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should return array of note objects', () => {
    const composer = new ScaleComposer('major', 'C');
    const notes = composer.getNotes();
    expect(Array.isArray(notes)).toBe(true);
    notes.forEach(noteObj => {
      expect(noteObj).toHaveProperty('note');
      expect(typeof noteObj.note).toBe('number');
    });
  });

  it('should respect octave range', () => {
    const composer = new ScaleComposer('major', 'C');
    const notes = composer.getNotes([3, 4]);
    notes.forEach(noteObj => {
      const octave = Math.floor(noteObj.note / 12);
      expect(octave).toBeGreaterThanOrEqual(3);
      expect(octave).toBeLessThanOrEqual(4);
    });
  });

  it('should return unique notes', () => {
    const composer = new ScaleComposer('major', 'C');
    const notes = composer.getNotes();
    const noteValues = notes.map(n => n.note);
    const uniqueNotes = [...new Set(noteValues)];
    expect(noteValues.length).toBe(uniqueNotes.length);
  });

  it('should generate notes based on voices setting', () => {
    const composer = new ScaleComposer('major', 'C');
    const voices = composer.getVoices();
    const notes = composer.getNotes();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBeGreaterThan(0);
    // Notes may be filtered for uniqueness, so could be less than voices
    expect(voices).toBeGreaterThan(0);
  });
});

describe('Edge cases', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should handle empty chord progression', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composer = new ChordComposer([]);
    expect(composer.progression).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('should handle all invalid chords', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composer = new ChordComposer(['Invalid1', 'Invalid2']);
    expect(composer.progression).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('should handle extreme bpmRatio', () => {
    bpmRatio = 10;
    const composer = new MeasureComposer();
    const result = composer.getNumerator();
    expect(result).toBeGreaterThan(0);
  });

  it('should handle zero bpmRatio', () => {
    bpmRatio = 0;
    const composer = new MeasureComposer();
    const result = composer.getNumerator();
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('MIDI compliance', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should generate valid MIDI note numbers', () => {
    const composer = new ScaleComposer('major', 'C');
    const notes = composer.getNotes();
    notes.forEach(noteObj => {
      expect(noteObj.note).toBeGreaterThanOrEqual(0);
      expect(noteObj.note).toBeLessThanOrEqual(127);
    });
  });

  it('should use reasonable octave ranges', () => {
    const composer = new MeasureComposer();
    const [o1, o2] = composer.getOctaveRange();
    expect(o1).toBeGreaterThanOrEqual(0);
    expect(o1).toBeLessThanOrEqual(10);
    expect(o2).toBeGreaterThanOrEqual(0);
    expect(o2).toBeLessThanOrEqual(10);
  });
});
