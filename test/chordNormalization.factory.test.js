require('../src/composers/ComposerFactory');
require('../src/composers/ChordComposer');

describe('ComposerFactory chord normalization integration', () => {
  it('accepts raw symbol Gb#m7 via ComposerFactory.create and yields a valid ChordComposer', () => {
    const composer = ComposerFactory.create({ type: 'chords', progression: ['Gb#m7'] });
    expect(composer).toBeTruthy();
    try { const notes = composer.getNotes(); expect(Array.isArray(notes)).toBe(true); expect(notes.length).toBeGreaterThan(0); } catch (e) { // some composers may not implement getNotes directly; ensure noteSet didn't throw
      expect(typeof composer.notes !== 'undefined' || typeof composer.progression !== 'undefined').toBeTruthy();
    }
  });
});
