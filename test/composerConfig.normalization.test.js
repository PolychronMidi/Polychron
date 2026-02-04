import { describe, it, expect } from 'vitest';

// Test that when the composers module loads it normalizes COMPOSERS entries
// originating from config so raw symbols like 'Gb#m7' are normalized.
describe('composers config normalization', () => {
  it('normalizes chord symbols in COMPOSERS entries on load', () => {
    // Save and replace global COMPOSERS for this test
    const orig = typeof COMPOSERS !== 'undefined' ? COMPOSERS.slice() : undefined;
    global.COMPOSERS = [{ type: 'chords', progression: ['Gb#m7', 'Cmaj7'] }];

    // Force a re-require of the composers index to trigger its init logic
    delete require.cache[require.resolve('../src/composers')];
    require('../src/composers');

    try {
      expect(COMPOSERS[0].progression[0]).toBe('Gm7');
      expect(COMPOSERS[0].progression[1]).toBe('Cmaj7');
    } finally {
      // restore
      if (typeof orig !== 'undefined') global.COMPOSERS = orig; else delete global.COMPOSERS;
      delete require.cache[require.resolve('../src/composers')];
      require('../src/composers');
    }
  });
});
