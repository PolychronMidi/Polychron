LOG = 'measure';
TUNING_FREQ = 432;
BINAURAL = {
  MIN: 8,
  MAX: 12
};
PPQ = 30000;
BPM = 60;
NUMERATOR = {
  MIN: 2,
  MAX: 15,
  WEIGHTS: [0.1, 0.2, 0.3, 0.4, 0.2, 0.1, 0.05, 0.01]
};
DENOMINATOR = {
  MIN: 3,
  MAX: 11,
  WEIGHTS: [0.1, 0.2, 0.3, 0.4, 0.2, 0.1, 0.05, 0.01]
};
DIVISIONS = {
  MIN: 0,
  MAX: 11,
  WEIGHTS: [.15, 2, 1, .7, 0.4, 0.2, 0.04, 0.03, 0.02, 0.02, 0.01]
};
SUBDIVS = {
  MIN: 0,
  MAX: 5,
  WEIGHTS: [.8, 3, 2, .04, .02, .01]
};
OCTAVE = {
  MIN: 1,
  MAX: 8,
  WEIGHTS: [0.12, 0.24, 0.33, 0.4, 0.4, 0.33, 0.07, 0.03]
};
VOICES = {
  MIN: 0,
  MAX: 7,
  WEIGHTS: [0.15, 0.3, 0.25, 0.07, 0.04, 0.03, 0.02, 0.01]
};
// MEASURES_PER_PHRASE = {
//   MIN: 2,
//   MAX: 4
// };
// PHRASES_PER_SECTION = {
//   MIN: 2,
//   MAX: 4
// };
// SECTIONS = {
//   MIN: 2,
//   MAX: 4
// };
MEASURES = {
  MIN: 10,
  MAX: 20
};
COMPOSERS = [
  // { type: 'scale', name: 'major', root: 'C', return: 'new ScaleComposer(this.name, this.root)' },
  { type: 'randomScale', return: 'new RandomScaleComposer()' },
  // { type: 'chordProgression', progression: ['Cmaj7', 'Dm', 'G', 'Cmaj7'], return: 'new ChordComposer(this.progression)' },
  { type: 'randomChordProgression', return: 'new RandomChordComposer()' }
];
SILENT_OUTRO_SECONDS = 5;
