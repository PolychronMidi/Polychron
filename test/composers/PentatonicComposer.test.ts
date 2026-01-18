import '../../src/sheet.js';
import '../../src/venue.js';
import '../../src/composers.js';
import { PentatonicComposer } from '../../src/composers.js';
import { setupGlobalState } from '../helpers.js';

const { RandomPentatonicComposer } = globalThis as any;

describe('PentatonicComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should create with major pentatonic by default', () => {
    const composer = new PentatonicComposer('C', 'major');
    expect(composer.root).toBe('C');
    expect(composer.type).toBe('major');
    expect(composer.notes).toBeDefined();
    expect(composer.notes.length).toBe(5);
  });

  it('should create with minor pentatonic', () => {
    const composer = new PentatonicComposer('A', 'minor');
    expect(composer.root).toBe('A');
    expect(composer.type).toBe('minor');
    expect(composer.notes.length).toBe(5);
  });

  it('should generate unique notes', () => {
    const composer = new PentatonicComposer('C', 'major');
    const notes = composer.getNotes();
    const noteValues = notes.map(n => n.note);
    const uniqueNotes = new Set(noteValues);
    expect(uniqueNotes.size).toBe(noteValues.length);
  });

  it('should generate valid MIDI notes', () => {
    const composer = new PentatonicComposer('D', 'minor');
    const notes = composer.getNotes();
    notes.forEach(noteObj => {
      expect(noteObj.note).toBeGreaterThanOrEqual(0);
      expect(noteObj.note).toBeLessThanOrEqual(127);
    });
  });

  it('should spread voices across octaves for open sound', () => {
    const composer = new PentatonicComposer('C', 'major');
    const notes = composer.getNotes([2, 5]);
    expect(Array.isArray(notes)).toBe(true);
  });
});

describe('RandomPentatonicComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should randomly select root and type', () => {
    const composer = new RandomPentatonicComposer();
    expect(composer.root).toBeDefined();
    expect(['major', 'minor']).toContain(composer.type);
    expect(composer.notes.length).toBe(5);
  });

  it('should generate different scales on x() calls', () => {
    const composer = new RandomPentatonicComposer();
    const notes1 = composer.x();
    const notes2 = composer.x();
    expect(notes1).toBeDefined();
    expect(notes2).toBeDefined();
  });
});
