require('../src/composers/ChordComposer');

describe('ChordComposer.normalizeChordSymbol (integration)', () => {
  it('accepts Gb#m7 as Gm7', () => {
    // Should not throw and should produce a valid chord
    const c = new ChordComposer(['Gb#m7']);
    expect(Array.isArray(c.notes)).toBe(true);
    expect(c.notes.length).toBeGreaterThan(0);
  });

  it('accepts Unicode flats/sharps', () => {
    const c = new ChordComposer(['G♭♯m7']);
    expect(Array.isArray(c.notes)).toBe(true);
    expect(c.notes.length).toBeGreaterThan(0);
  });
});
