require('../src/fx/stutterManager'); // ensures Stutter and helper are loaded via fx/index.js

describe('stutterNotes helper', () => {
  it('initializes and preserves shared shape', () => {
    const shared = {};
    const res = Stutter.stutterNotes({ profile: 'source', channel: 'ch1', note: 60, on: 0, sustain: 10, velocity: 80, binVel: 40, isPrimary: true, shared });
    expect(shared.stutters instanceof Map).toBe(true);
    expect(shared.shifts instanceof Map).toBe(true);
    expect(typeof shared.global === 'object').toBe(true);
    // returned shared should match
    expect(res).toBe(shared);
  });

  it('uses injected RNG and emits events from pre-seeded global plan', () => {
    // Capture p calls
    const calls = [];
    const origP = typeof p !== 'undefined' ? p : undefined;
    global.p = (...args) => calls.push(args);

    const shared = { stutters: new Map(), shifts: new Map(), global: { applied: true, data: { numStutters: 2, duration: 1, minVelocity: 11, maxVelocity: 100, isFadeIn: true, decay: 1 } } };

    // Provide deterministic RNGs
    const rf = () => 0.1; // triggers comparisons predictably
    const ri = (a) => a; // deterministic

    const res = Stutter.stutterNotes({ profile: 'source', channel: 'chX', note: 60, on: 100, sustain: 20, velocity: 80, binVel: 40, isPrimary: true, shared, rf, ri });

    expect(shared.global.data).toBeDefined();
    expect(calls.length).toBeGreaterThan(0);

    // restore p
    if (origP) global.p = origP; else delete global.p;
  });
});