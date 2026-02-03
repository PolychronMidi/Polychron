// Tests for MotifSpreader.getBeatMotifPicks
// Ensures it prefers MeasureComposer.voice-leading selection, falls back to layer.voiceLeading,
// and uses round-robin cursor behavior when no voice-leading is available.

// Vitest globals are enabled via vitest.config.mjs (globals: true)
require('../src/composers/motifSpreader.js');

describe('MotifSpreader.getBeatMotifPicks', () => {
  beforeEach(() => {
    // reset any lingering history/cursors from previous tests
    if (global.MotifSpreader && MotifSpreader._reset) MotifSpreader._reset();
  });

  it('prefers measureComposer.selectNoteWithLeading when present', () => {
    const layer = {
      beatMotifs: {
        0: [
          { note: 60, groupId: 'g', seqIndex: 0, seqLen: 3 },
          { note: 67, groupId: 'g', seqIndex: 1, seqLen: 3 },
          { note: 72, groupId: 'g', seqIndex: 2, seqLen: 3 }
        ]
      },
      measureComposer: {
        selectNoteWithLeading: (cands) => cands[1]
      }
    };

    const picks = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    expect(picks.length).toBe(1);
    expect(picks[0].note).toBe(67);
  });

  it('falls back to layer.voiceLeading.selectNextNote when measureComposer absent', () => {
    const layer = {
      beatMotifs: { 0: [{ note: 50 }, { note: 51 }, { note: 52 }] },
      voiceLeading: { selectNextNote: (_hist, cands) => cands[2] }
    };

    const picks = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    expect(picks[0].note).toBe(52);
  });

  it('uses round-robin cursor when no leading', () => {
    const layer = { beatMotifs: { 0: [{ note: 10 }, { note: 11 }, { note: 12 }] } };

    const p1 = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    const p2 = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    const p3 = MotifSpreader.getBeatMotifPicks(layer, 0, 1);

    expect([p1[0].note, p2[0].note, p3[0].note]).toEqual([10, 11, 12]);
  });

  it('respects max (>1) and returns distinct picks advancing cursor', () => {
    const layer = { beatMotifs: { 0: [{ note: 20 }, { note: 21 }, { note: 22 }, { note: 23 }] } };
    const picks = MotifSpreader.getBeatMotifPicks(layer, 0, 3);
    expect(picks.length).toBe(3);
    expect(new Set(picks.map(p => p.note)).size).toBe(3);
  });
});
