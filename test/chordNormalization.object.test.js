require('../src/composers/ChordComposer');

describe('ChordComposer.normalizeChordSymbol handles object inputs', () => {
  it('accepts objects with symbol property', () => {
    const c = new ChordComposer([{ symbol: 'Gb#m7' }]);
    expect(Array.isArray(c.notes)).toBe(true);
    expect(c.notes.length).toBeGreaterThan(0);
  });
});
