// test/motifs.test.js
import "../dist/motifs.js";const baseMotif = new Motif([60, 62, { note: 64, duration: 2 }]);

describe('Motif transformations', () => {
  it('should transpose without mutating original', () => {
    const transposed = baseMotif.transpose(5);
    expect(transposed.events.map(e => e.note)).toEqual([65, 67, 69]);
    expect(baseMotif.events.map(e => e.note)).toEqual([60, 62, 64]);
  });

  it('should invert around first note by default', () => {
    const inverted = baseMotif.invert();
    expect(inverted.events.map(e => e.note)).toEqual([60, 58, 56]);
  });

  it('should augment and diminish durations', () => {
    const augmented = baseMotif.augment(2);
    expect(augmented.events.map(e => e.duration)).toEqual([2, 2, 4]);
    const diminished = baseMotif.diminish(2);
    expect(diminished.events.map(e => e.duration)).toEqual([0.5, 0.5, 1]);
  });

  it('should apply motif offsets to note objects without mutation', () => {
    const notes = [{ note: 50 }, { note: 52 }, { note: 54 }];
    const result = baseMotif.applyToNotes(notes);
    // baseMotif = [60, 62, 64], baseNote = 60
    // offsets: [0, 2, 4]
    // applied: [50+0, 52+2, 54+4] = [50, 54, 58]
    expect(result.map(n => n.note)).toEqual([50, 54, 58]);
    expect(notes.map(n => n.note)).toEqual([50, 52, 54]);

    const shiftedMotif = new Motif([0, 3]);
    const shifted = shiftedMotif.applyToNotes(notes, { clampMin: 0, clampMax: 120 });
    // shiftedMotif = [0, 3], baseNote = 0, offsets = [0, 3]
    // applied: [50+0, 52+3, 54+0] = [50, 55, 54]
    expect(shifted.map(n => n.note)).toEqual([50, 55, 54]);
  });

  it('should develop with transpose + invert + reverse when requested', () => {
    // baseMotif = [60, 62, 64], durations [1, 1, 2]
    // transpose(12) = [72, 74, 76], durations [1, 1, 2]
    // invert(60): [48, 46, 44], durations [1, 1, 2]
    // reverse: [44, 46, 48], durations [2, 1, 1]
    // augment(2): [44, 46, 48], durations [4, 2, 2]
    const developed = baseMotif.develop({ transposeBy: 12, invertPivot: 60, reverse: true, scale: 2 });
    expect(developed.events.map(e => e.note)).toEqual([44, 46, 48]);
    expect(developed.events.map(e => e.duration)).toEqual([4, 2, 2]);
  });
});
