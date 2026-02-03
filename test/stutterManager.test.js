require('../src/fx/stutterManager');

describe('StutterManager basic behavior', () => {
  it('stutterFade default parameters and binding work', () => {
    // Replace internal implementation to observe behavior
    const observed = {};
    Stutter._stutterFade = (channels, numStutters, duration) => ({ channels, numStutters, duration });

    const res = Stutter.stutterFade(['x']);
    expect(res.channels).toEqual(['x']);
    expect(typeof res.numStutters).toBe('number');
    expect(typeof res.duration).toBe('number');

    // Global binding should also call through
    const res2 = stutterFade(['y']);
    expect(res2.channels).toEqual(['y']);
  });

  it('resetChannelTracking clears sets and accepts channel list', () => {
    // Ensure deterministic start
    Stutter.lastUsedCHs.clear();
    Stutter.lastUsedCHs2.clear();
    Stutter.lastUsedCHs.add('a');
    Stutter.lastUsedCHs2.add('b');
    // Debug sizes immediately after add
    try { if (typeof console !== 'undefined' && console && typeof console.debug === 'function') console.debug('test: after add', { s1: Stutter.lastUsedCHs.size, s2: Stutter.lastUsedCHs2.size }); } catch (e) { console.warn('Test debug logging failed:', e && e.stack ? e.stack : e); }
    expect(Stutter.lastUsedCHs.size).toBe(1);
    expect(Stutter.lastUsedCHs2.size).toBe(1);

    const full = Stutter.resetChannelTracking();
    // Ensure function returns a cleared count and that sets are now empty
    expect(typeof full.cleared).toBe('number');
    expect(Stutter.lastUsedCHs.size).toBe(0);
    expect(Stutter.lastUsedCHs2.size).toBe(0);

    // add back and clear specific
    Stutter.lastUsedCHs.add('c');
    Stutter.lastUsedCHs2.add('d');
    const partial = Stutter.resetChannelTracking(['c']);
    expect(typeof partial.cleared).toBe('number');
    expect(Stutter.lastUsedCHs.has('c')).toBe(false);
  });
});