require('../src/composers/ChordComposer');

describe('ChordComposer.normalizeChordSymbol (integration)', () => {
  it('accepts Gb#m7 as Gm7 and logs acceptable warning', () => {
    // Capture console.warn
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const c = new ChordComposer(['Gb#m7']);
      expect(Array.isArray(c.notes)).toBe(true);
      expect(c.notes.length).toBeGreaterThan(0);
      // Should have logged the acceptable normalization warning
      const found = warnings.some(w => w.startsWith('Acceptable warning:') && w.includes('Gb#m7') && w.includes('Gm7'));
      expect(found).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it('accepts Unicode flats/sharps', () => {
    const c = new ChordComposer(['G♭♯m7']);
    expect(Array.isArray(c.notes)).toBe(true);
    expect(c.notes.length).toBeGreaterThan(0);
  });
});
