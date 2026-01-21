import '../../src/sheet.js';
import '../../src/venue.js';
import { ComposerFactory, PentatonicComposer } from '../../src/composers/index.js';

describe('ComposerFactory - Phase 2 Extensions', () => {

  it('should create PentatonicComposer from config', () => {
    const config = { type: 'pentatonic', root: 'E', pentatonicType: 'minor' };
    const composer = ComposerFactory.create(config);
    expect(composer).toBeInstanceOf(PentatonicComposer);
  });

  it('should create RandomPentatonicComposer from config', () => {
    const config = { type: 'pentatonic', root: 'random', scaleType: 'random' };
    const composer = ComposerFactory.create(config);
    expect(composer).toBeInstanceOf(PentatonicComposer);
  });

  it('should create TensionReleaseComposer from config', () => {
    const config = { type: 'tensionRelease', key: 'F', quality: 'major', tensionCurve: 0.6 };
    const composer = ComposerFactory.create(config);
    expect(composer).toBeTruthy();
    expect(typeof (composer as any).calculateTension).toBe('function');
    expect(typeof (composer as any).selectChordByTension).toBe('function');
  });

  it('should create ModalInterchangeComposer from config', () => {
    const config = { type: 'modalInterchange', key: 'G', primaryMode: 'minor', borrowProbability: 0.4 };
    const composer = ComposerFactory.create(config);
    expect(composer).toBeTruthy();
    expect(typeof (composer as any).borrowChord).toBe('function');
    expect(Array.isArray((composer as any).borrowModes)).toBe(true);
  });

  it('should create composers and generate valid notes', () => {
    const configs = [
      { type: 'pentatonic', root: 'C', scaleType: 'major' },
      { type: 'pentatonic', root: 'random', scaleType: 'random' },
      { type: 'tensionRelease', quality: 'major', tensionCurve: 0.6 },
      { type: 'modalInterchange', primaryMode: 'major', borrowProbability: 0.3 },
      { type: 'melodicDevelopment', name: 'major', root: 'C', developmentIntensity: 0.6 },
      { type: 'advancedVoiceLeading', name: 'major', root: 'C', commonToneWeight: 0.7 }
    ];

    configs.forEach(config => {
      const composer = ComposerFactory.create(config);
      const notes = composer.x ? composer.x() : composer.getNotes();
      expect(notes).toBeDefined();
      expect(Array.isArray(notes)).toBe(true);
    });
  });
});
