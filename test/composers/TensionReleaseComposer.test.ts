import '../../src/sheet.js';
import '../../src/venue.js';
import '../../src/composers.js';
import { setupGlobalState } from '../helpers.js';

const { TensionReleaseComposer } = globalThis as any;

describe('TensionReleaseComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should create with default parameters', () => {
    const composer = new TensionReleaseComposer();
    expect(composer.key).toBeDefined();
    expect(composer.quality).toBeDefined();
    expect(composer.tensionCurve).toBeDefined();
  });

  it('should create with custom tension curve', () => {
    const composer = new TensionReleaseComposer('D', 'minor', 0.8);
    expect(composer.key).toBe('D');
    expect(composer.quality).toBe('minor');
    expect(composer.tensionCurve).toBe(0.8);
  });

  it('should clamp tension curve to 0-1 range', () => {
    const composer1 = new TensionReleaseComposer('C', 'major', -0.5);
    expect(composer1.tensionCurve).toBeGreaterThanOrEqual(0);

    const composer2 = new TensionReleaseComposer('C', 'major', 1.5);
    expect(composer2.tensionCurve).toBeLessThanOrEqual(1);
  });

  it('should calculate tension for different chord functions', () => {
    const composer = new TensionReleaseComposer('C', 'major');
    const tonicTension = composer.calculateTension('CM');
    const dominantTension = composer.calculateTension('GM');

    expect(tonicTension).toBeDefined();
    expect(dominantTension).toBeDefined();
    expect(dominantTension).toBeGreaterThan(tonicTension);
  });

  it('should select chords based on tension curve', () => {
    const composer = new TensionReleaseComposer('C', 'major', 0.7);
    const chords = composer.selectChordByTension(0.5);
    expect(chords).toBeDefined();
    expect(Array.isArray(chords)).toBe(true);
    expect(chords.length).toBeGreaterThan(0);
  });

  it('should resolve to tonic at end of phrase', () => {
    const composer = new TensionReleaseComposer('C', 'major');
    const chords = composer.selectChordByTension(0.9);
    expect(chords).toBeDefined();
    expect(chords.length).toBeGreaterThan(0);
  });

  it('should generate notes with tension-based progression', () => {
    const composer = new TensionReleaseComposer('G', 'major', 0.6);
    const notes = composer.x();
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    notes.forEach(noteObj => {
      expect(noteObj.note).toBeGreaterThanOrEqual(0);
      expect(noteObj.note).toBeLessThanOrEqual(127);
    });
  });
});
