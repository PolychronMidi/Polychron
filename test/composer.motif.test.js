import { expect, test } from 'vitest';

// Ensure runtime globals are initialized (stage loads composers and venue)
require('../src/stage');

// Base smoke test
test('MotifComposer generates motif of requested length', () => {
  const mc = new MotifComposer({ useVoiceLeading: false });
  const motif = mc.generate({ length: 4 });
  expect(motif).toBeDefined();
  const seq = motif.events || motif.sequence || [];
  expect(seq.length).toBe(4);
  seq.forEach(evt => {
    expect(typeof evt.note).toBe('number');
    expect(evt.note).toBeGreaterThanOrEqual(0);
    expect(evt.note).toBeLessThanOrEqual(127);
  });
});

// Duration unit test: set unit globals and ensure produced durations roughly match
test('MotifComposer respects durationUnit', () => {
  // set predictable timing globals (naked globals used by project)
  tpMeasure = 1920; // 4 beats @ 480
  tpBeat = 480;
  tpDiv = 120;
  tpSubdiv = 30;
  const mc = new MotifComposer({ durationUnit: 'beat', durationScale: 1 });
  const motif = mc.generate({ length: 4, defaultDuration: 1 });
  const seq = motif.sequence || motif.events || [];
  expect(seq.length).toBe(4);
  seq.forEach(evt => {
    expect(typeof evt.duration).toBe('number');
    // Expect durations to be in the neighborhood of tpBeat (±20%)
    expect(evt.duration).toBeGreaterThanOrEqual(Math.round(tpBeat * 0.8));
    expect(evt.duration).toBeLessThanOrEqual(Math.round(tpBeat * 1.2));
  });
});

// Integration test: support a developer composer input and measureComposer integration
test('MotifComposer integrate with developFromComposer and measureComposer', () => {
  // Mock developer that returns fixed notes
  const dev = { getNotes: () => [{note:60},{note:62},{note:64}] };
  const mc = new MotifComposer({ developFromComposer: dev, length: 3, durationUnit: 'subdiv' });
  const motif = mc.generate();
  const seq = motif.sequence || motif.events || [];
  expect(seq.length).toBe(3);
  // notes should be drawn from dev notes (or their octaves)
  const mods = seq.map(e => ((e.note % 12) + 12) % 12);
  expect(mods.every(m => [60%12,62%12,64%12].includes(m))).toBe(true);

  // Mock measureComposer that forces selection
  const forced = { selectNoteWithLeading: () => 72 };
  const mc2 = new MotifComposer({ length: 2 });
  const motif2 = mc2.generate({ measureComposer: forced });
  const seq2 = motif2.sequence || motif2.events || [];
  expect(seq2.every(e => e.note === 72)).toBe(true);
});
