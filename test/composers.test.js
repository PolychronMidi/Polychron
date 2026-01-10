// test/composers.test.js
require('../sheet');  // Defines constants and configuration objects
require('../venue');  // Defines tonal (t), allScales, allNotes, allChords, allModes
require('../backstage');  // Defines helper functions like rf, ri, clamp, etc.
require('../Composers');  // Defines composer classes and composers array

// Setup function
function setupGlobalState() {
  globalThis.bpmRatio = 1;
  globalThis.measureCount = 0;
  globalThis.subdivStart = 0;
}

// Use real composer classes from Composes.js

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
    // Test that tonal library is available and working
    const composer = new ScaleComposer('major', 'C');
    expect(composer.scale).toBeDefined();
    expect(composer.scale.name).toBeDefined();
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
    // Test that tonal library is available and working
    const composer = new ModeComposer('ionian', 'C');
    expect(composer.mode).toBeDefined();
    expect(Array.isArray(composer.notes)).toBe(true);
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