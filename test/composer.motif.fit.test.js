import { expect, test } from 'vitest';
require('../src/stage');

test('MotifComposer can fit motif to total ticks exactly', () => {
  const mc = new MotifComposer();
  const totalTicks = 1920; // 1 measure
  const m = mc.generate({ length: 5, fitToTotalTicks: true, totalTicks });
  const seq = m.sequence || m.events || [];
  const sum = seq.reduce((a, b) => a + (b.duration || 0), 0);
  expect(seq.length).toBe(5);
  expect(sum).toBe(totalTicks);
});

// Integration point test for play.js motif generation helper
test('play generates activeMotif matching phrase duration', () => {
  // Prepare environment
  composer = { getNotes: () => [{note:60},{note:62}], voiceLeading: null, selectNoteWithLeading: null };
  measuresPerPhrase = 2;
  tpMeasure = 1920; // each measure
  // invoke the same block as play does by forcing generation
  try {
    const mc = new MotifComposer();
    const phraseTicks = Number(tpMeasure) * Number(measuresPerPhrase);
    const motif = mc.generate({ length: 4, fitToTotalTicks: true, totalTicks: phraseTicks, developFromComposer: composer, measureComposer: composer });
    activeMotif = motif;
    const seq = motif.sequence || motif.events || [];
    const sum = seq.reduce((a, b) => a + (b.duration || 0), 0);
    expect(sum).toBe(phraseTicks);
  } catch (e) {
    throw e;
  }
});
