import { ModalInterchangeComposer } from '../../src/composers/index.js';

describe('ModalInterchangeComposer', () => {
  // No global setup; composers import their dependencies from `src/venue.ts` and `src/utils.ts`.

  it('should create with default parameters', () => {
    const composer = new ModalInterchangeComposer();
    expect(composer.key).toBeDefined();
    expect(composer.primaryMode).toBeDefined();
    expect(composer.borrowProbability).toBeDefined();
  });

  it('should create with custom borrow probability', () => {
    const composer = new ModalInterchangeComposer('C', 'major', 0.5);
    expect(composer.key).toBe('C');
    expect(composer.primaryMode).toBe('major');
    expect(composer.borrowProbability).toBe(0.5);
  });

  it('should clamp borrow probability to 0-1', () => {
    const composer1 = new ModalInterchangeComposer('C', 'major', -0.2);
    expect(composer1.borrowProbability).toBeGreaterThanOrEqual(0);

    const composer2 = new ModalInterchangeComposer('C', 'major', 1.5);
    expect(composer2.borrowProbability).toBeLessThanOrEqual(1);
  });

  it('should define borrow modes for major', () => {
    const composer = new ModalInterchangeComposer('C', 'major');
    expect(composer.borrowModes).toBeDefined();
    expect(Array.isArray(composer.borrowModes)).toBe(true);
    expect(composer.borrowModes.length).toBeGreaterThan(0);
  });

  it('should define borrow modes for minor', () => {
    const composer = new ModalInterchangeComposer('A', 'minor');
    expect(composer.borrowModes).toBeDefined();
    expect(Array.isArray(composer.borrowModes)).toBe(true);
    expect(composer.borrowModes.length).toBeGreaterThan(0);
  });

  it('should borrow chords from parallel modes', () => {
    const composer = new ModalInterchangeComposer('C', 'major', 1.0);
    const borrowedChord = composer.borrowChord();
    expect(borrowedChord).toBeDefined();
    expect(Array.isArray(borrowedChord)).toBe(true);
  });

  it('should generate notes with modal interchange', () => {
    const composer = new ModalInterchangeComposer('D', 'major', 0.3);
    const notes = composer.x();
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    notes.forEach(noteObj => {
      expect(noteObj.note).toBeGreaterThanOrEqual(0);
      expect(noteObj.note).toBeLessThanOrEqual(127);
    });
  });

  it('should work with zero borrow probability', () => {
    const composer = new ModalInterchangeComposer('C', 'major', 0);
    const notes = composer.x();
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
  });
});
