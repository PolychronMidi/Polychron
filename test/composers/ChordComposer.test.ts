import { ChordComposer, RandomChordComposer } from '../../src/composers/ChordComposer.js';

describe('ChordComposer', () => {
  beforeEach(() => {});

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
    composer.itemSet(['C', 'F', 'G'], 'R');
    expect(composer.currentChordIndex).toBeGreaterThanOrEqual(0);
  });

  it('should handle direction L (left)', () => {
    const composer = new ChordComposer(['C', 'F', 'G']);
    composer.itemSet(['C', 'F', 'G'], 'L');
    expect(composer.currentChordIndex).toBeGreaterThanOrEqual(0);
  });
});

describe('RandomChordComposer', () => {
  beforeEach(() => {});

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

describe('ChordComposer edge cases', () => {
  beforeEach(() => {});

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
});

describe('ChordComposer.noteSet integration', () => {
  beforeEach(() => {});

  it('should accept valid chord progression', () => {
    const progression = ['CM', 'Dm', 'Em', 'FM'];
    const composer = new ChordComposer(progression);
    expect(composer.progression).toBeDefined();
    expect(composer.progression.length).toBe(4);
  });

  it('should filter invalid chords from progression', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const progression = ['CM', 'InvalidChord', 'Dm'];
    const composer = new ChordComposer(progression);
    expect(composer.progression).toBeDefined();
    expect(composer.progression.length).toBeLessThanOrEqual(3);
    vi.restoreAllMocks();
  });

  it('should set progression with right direction (default)', () => {
    const progression = ['CM', 'Dm', 'Em'];
    const composer = new ChordComposer(progression);
    composer.itemSet(progression, 'R');
    expect(composer.currentChordIndex).toBeDefined();
    expect(composer.currentChordIndex).toBeGreaterThanOrEqual(0);
  });

  it('should set progression with left direction', () => {
    const progression = ['CM', 'Dm', 'Em'];
    const composer = new ChordComposer(progression);
    composer.itemSet(progression, 'L');
    expect(composer.currentChordIndex).toBeDefined();
  });

  it('should set progression with either direction (random)', () => {
    const progression = ['CM', 'Dm', 'Em'];
    const composer = new ChordComposer(progression);
    composer.itemSet(progression, 'E');
    expect(composer.currentChordIndex).toBeDefined();
  });

  it('should set progression with random jump direction', () => {
    const progression = ['CM', 'Dm', 'Em', 'FM', 'GM'];
    const composer = new ChordComposer(progression);
    composer.itemSet(progression, '?');
    expect(composer.currentChordIndex).toBeDefined();
    expect(composer.currentChordIndex).toBeGreaterThanOrEqual(0);
    expect(composer.currentChordIndex).toBeLessThan(progression.length);
  });

  it('should return notes for current chord via x()', () => {
    const progression = ['CM', 'Dm', 'Em'];
    const composer = new ChordComposer(progression);
    const notes = composer.x();
    expect(Array.isArray(notes)).toBe(true);
    notes.forEach(note => {
      expect(typeof note.note).toBe('number');
    });
  });

  it('should maintain chord index within bounds', () => {
    const progression = ['CM', 'Dm', 'Em'];
    const composer = new ChordComposer(progression);
    for (let i = 0; i < 10; i++) {
      const direction = ['R', 'L', 'E', '?'][i % 4];
      composer.itemSet(progression, direction);
      expect(composer.currentChordIndex).toBeGreaterThanOrEqual(0);
      expect(composer.currentChordIndex).toBeLessThan(progression.length);
    }
  });
});

describe('RandomChordComposer integration', () => {
  beforeEach(() => {});

  it('should generate random chord progression on construction', () => {
    const composer = new RandomChordComposer();
    expect(composer.progression).toBeDefined();
    expect(composer.progression.length).toBeGreaterThanOrEqual(2);
    expect(composer.progression.length).toBeLessThanOrEqual(5);
  });

  it('should generate different progressions on multiple calls', () => {
    const progressions: string[] = [];
    for (let i = 0; i < 8; i++) {
      const composer = new RandomChordComposer();
      progressions.push(JSON.stringify(composer.progression));
    }
    const unique = new Set(progressions);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('should return notes from random progression via x()', () => {
    const composer = new RandomChordComposer();
    const notes = composer.x();
    expect(Array.isArray(notes)).toBe(true);
    notes.forEach(note => {
      expect(typeof note.note).toBe('number');
    });
  });

  it('should regenerate progression on each x() call', () => {
    const composer = new RandomChordComposer();
    const notes1 = composer.x();
    const notes2 = composer.x();
    expect(Array.isArray(notes1)).toBe(true);
    expect(Array.isArray(notes2)).toBe(true);
  });

  it('should generate valid chord notes', () => {
    for (let i = 0; i < 5; i++) {
      const composer = new RandomChordComposer();
      const notes = composer.x();
      notes.forEach(note => {
        expect(note.note).toBeGreaterThanOrEqual(0);
        expect(note.note).toBeLessThanOrEqual(127);
      });
    }
  });
});
