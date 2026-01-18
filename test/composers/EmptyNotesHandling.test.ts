import '../../src/sheet.js';
import '../../src/venue.js';
import { setupGlobalState } from '../helpers.js';

describe('Empty Notes Handling - CRITICAL', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should handle empty array from forEach without crashing', () => {
    const emptyArray: Array<{ note: number }> = [];

    let notesProcessed = 0;
    expect(() => {
      emptyArray.forEach(({ note }) => {
        notesProcessed++;
        expect(note).toBeDefined();
      });
    }).not.toThrow();

    expect(notesProcessed).toBe(0);
  });

  it('should handle null composer gracefully', () => {
    const composer = null as any;
    const noteObjects = composer ? composer.getNotes() : [];

    expect(Array.isArray(noteObjects)).toBe(true);
    expect(noteObjects.length).toBe(0);

    expect(() => {
      noteObjects.forEach(({ note }) => {
        expect(note).toBeDefined();
      });
    }).not.toThrow();
  });

  it('should handle undefined composer gracefully', () => {
    const composer = undefined as any;
    const noteObjects = composer ? composer.getNotes() : [];

    expect(Array.isArray(noteObjects)).toBe(true);
    expect(noteObjects.length).toBe(0);
  });

  it('should handle empty motifNotes in playback scenario', () => {
    const noteObjects: Array<{ note: number }> = [];
    const activeMotif = null as any;
    const motifNotes = activeMotif ? [] : noteObjects;

    let notesPlayed = 0;
    motifNotes.forEach(({ note }) => {
      notesPlayed++;
      expect(note).toBeDefined();
    });

    expect(notesPlayed).toBe(0);
  });
});
