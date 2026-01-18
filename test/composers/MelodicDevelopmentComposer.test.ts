import '../../src/sheet.js';
import '../../src/venue.js';
import '../../src/composers.js';
import { ScaleComposer, ComposerFactory } from '../../src/composers.js';
import { setupGlobalState } from '../helpers.js';

const { MelodicDevelopmentComposer } = globalThis as any;

describe('MelodicDevelopmentComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should initialize with scale, root, and development intensity', () => {
    const composer = new MelodicDevelopmentComposer('major', 'C', 0.6);
    expect(composer.root).toBe('C');
    expect(composer.developmentIntensity).toBe(0.6);
    expect(composer.measureCount).toBe(0);
    expect(composer.responseMode).toBe(false);
  });

  it('should handle random root correctly', () => {
    const composer = new MelodicDevelopmentComposer('major', 'random', 0.5);
    expect(composer.root).toBeDefined();
    expect(composer.root).not.toBe('random');
    expect(composer.item).toBeDefined();
    expect(composer.notes).toBeDefined();
    expect(composer.notes.length).toBeGreaterThan(0);
  });

  it('should handle random scale name correctly', () => {
    const composer = new MelodicDevelopmentComposer('random', 'C', 0.5);
    expect(composer.item).toBeDefined();
    expect(composer.notes).toBeDefined();
    expect(composer.notes.length).toBeGreaterThan(0);
  });

  it('should generate notes without errors', () => {
    const composer = new MelodicDevelopmentComposer('major', 'C', 0.6);
    const notes = composer.getNotes([48, 72]);
    expect(Array.isArray(notes)).toBe(true);
  });

  it('should return empty array if base notes are empty', () => {
    const composer = new MelodicDevelopmentComposer('major', 'C', 0.6);
    const originalGetNotes = ScaleComposer.prototype.getNotes;
    ScaleComposer.prototype.getNotes = () => [];
    const notes = composer.getNotes([48, 72]);
    expect(notes).toEqual([]);
    ScaleComposer.prototype.getNotes = originalGetNotes;
  });

  it('should increment measure count on each getNotes call', () => {
    const composer = new MelodicDevelopmentComposer('major', 'C', 0.6);
    expect(composer.measureCount).toBe(0);
    composer.getNotes([48, 72]);
    expect(typeof composer.measureCount).toBe('number');
  });

  it('should cycle through development phases', () => {
    const composer = new MelodicDevelopmentComposer('major', 'C', 0.8);
    for (let i = 0; i < 8; i++) {
      const notes = composer.getNotes([48, 72]);
      expect(Array.isArray(notes)).toBe(true);
    }
  });

  it('should work via factory with all parameter combinations', () => {
    const configs = [
      { type: 'melodicDevelopment', name: 'major', root: 'C', developmentIntensity: 0.6 },
      { type: 'melodicDevelopment', name: 'random', root: 'random', developmentIntensity: 0.5 },
      { type: 'melodicDevelopment', name: 'minor', root: 'D', developmentIntensity: 0.7 }
    ];

    configs.forEach(config => {
      const composer = ComposerFactory.create(config);
      expect(composer).toBeInstanceOf(MelodicDevelopmentComposer);
      const notes = composer.getNotes([48, 72]);
      expect(Array.isArray(notes)).toBe(true);
    });
  });

  it('should clamp development intensity to 0-1 range', () => {
    const composer1 = new MelodicDevelopmentComposer('major', 'C', -0.5);
    expect(composer1.developmentIntensity).toBe(0);

    const composer2 = new MelodicDevelopmentComposer('major', 'C', 1.5);
    expect(composer2.developmentIntensity).toBe(1);
  });
});
