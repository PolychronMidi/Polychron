INSTRUMENT='glockenspiel';
LOG='measure';
TUNING_FREQ=432;
BINAURAL={
  MIN: 8,
  MAX: 12
};
PPQ=30000;
BPM=80;
NUMERATOR={
  MIN: 2,
  MAX: 15,
  WEIGHTS: [10, 20, 30, 40, 20, 10, 5, 1]
};
DENOMINATOR={
  MIN: 3,
  MAX: 11,
  WEIGHTS: [10, 20, 30, 40, 20, 10, 5, 1]
};
OCTAVE={
  MIN: 1,
  MAX: 8,
  WEIGHTS: [12, 24, 33, 40, 40, 33, 7, 3]
};
VOICES={
  MIN: 0,
  MAX: 7,
  WEIGHTS: [15, 30, 25, 7, 4, 3, 2, 1]
};
// TODO: implement motifs, phrases, sections, and section types (introduction, exposition, development, conclusion, fugue).
// SECTIONS={
//   MIN: 2,
//   MAX: 4
// };
// PHRASES_PER_SECTION={
//   MIN: 2,
//   MAX: 4
// };
// MEASURES_PER_PHRASE={
//   MIN: 2,
//   MAX: 4
// };
MEASURES={
  MIN: 10,
  MAX: 20
};
DIVISIONS={
  MIN: 0,
  MAX: 12,
  WEIGHTS: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1]
};
SUBDIVISIONS={
  MIN: 0,
  MAX: 12,
  WEIGHTS: [5, 10, 20, 15, 20, 10, 50, 4, 2, 1]
};
COMPOSERS=[
  // { type: 'scale', name: 'major', root: 'C', return: 'new ScaleComposer(this.name, this.root)' },
  // { type: 'chordProgression', progression: ['Cmaj7', 'Dm', 'G', 'Cmaj7'], return: 'new ChordComposer(this.progression)' },
  // { type: 'mode', name: 'ionian', root: 'C', return: 'new ModeComposer(this.name, this.root)' },
  { type: 'randomScale', return: 'new RandomScaleComposer()' },
  { type: 'randomChordProgression', return: 'new RandomChordComposer()' },
  { type: 'randomMode', return: 'new RandomModeComposer()' }
];
SILENT_OUTRO_SECONDS=5;
