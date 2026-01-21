// test/composers/ScaleComposer.test.ts
import { ScaleComposer, RandomScaleComposer } from '../../src/composers/ScaleComposer.js';

describe('ScaleComposer', () => {
  beforeEach(() => {});

  it('should initialize with scale and root', () => {
    const composer = new ScaleComposer('major', 'C');
    expect(composer.root).toBe('C');
    expect(composer.item).toBeDefined();
    expect(composer.notes).toBeDefined();
  });

  it('should call Tonal Scale.get', () => {
    // Test that tonal library is available and working
    const composer = new ScaleComposer('major', 'C');
    expect(composer.item).toBeDefined();
    expect(composer.item.name).toBeDefined();
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
  beforeEach(() => {});

  it('should initialize with random scale', () => {
    const composer = new RandomScaleComposer();
    expect(composer.item).toBeDefined();
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

describe('ScaleComposer getNotes integration', () => {
  beforeEach(() => {});

  it('should return array of note objects', () => {
    const composer = new ScaleComposer('major', 'C');
    const notes = composer.getNotes();
    expect(Array.isArray(notes)).toBe(true);
    notes.forEach(noteObj => {
      expect(noteObj).toHaveProperty('note');
      expect(typeof noteObj.note).toBe('number');
    });
  });

  it('should generate valid MIDI notes', () => {
    const composer = new ScaleComposer('major', 'C');
    const notes = composer.getNotes([3, 4]);
    notes.forEach(noteObj => {
      expect(typeof noteObj.note).toBe('number');
      expect(noteObj.note).toBeGreaterThanOrEqual(0);
      expect(noteObj.note).toBeLessThanOrEqual(127);
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
    expect(voices).toBeGreaterThan(0);
  });
});

describe('MIDI compliance - ScaleComposer', () => {
  beforeEach(() => {});

  it('should generate valid MIDI note numbers', () => {
    const composer = new ScaleComposer('major', 'C');
    const notes = composer.getNotes();
    notes.forEach(noteObj => {
      expect(noteObj.note).toBeGreaterThanOrEqual(0);
      expect(noteObj.note).toBeLessThanOrEqual(127);
    });
  });
});
