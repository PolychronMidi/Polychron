INSTRUMENT = 'glockenspiel';
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
  WEIGHTS: [.1, .2, .3, .4, .2, .1, .05, .01]
};
DENOMINATOR = {
  MIN: 3,
  MAX: 11,
  WEIGHTS: [.1, .2, .3, .4, .2, .1, .05, .01]
};
OCTAVE = {
  MIN: 1,
  MAX: 8,
  WEIGHTS: [.12, .24, .33, .4, .4, .33, .07, .03]
};
VOICES = {
  MIN: 0,
  MAX: 7,
  WEIGHTS: [.15, .3, .25, .07, .04, .03, .02, .01]
};
// TODO: implement motifs, phrases, sections, and section types (introduction, exposition, development, conclusion, fugue).
// SECTIONS = {
//   MIN: 2,
//   MAX: 4
// };
// PHRASES_PER_SECTION = {
//   MIN: 2,
//   MAX: 4
// };
// MEASURES_PER_PHRASE = {
//   MIN: 2,
//   MAX: 4
// };
MEASURES = {
  MIN: 10,
  MAX: 20
};
DIVISIONS = {
  MIN: 0,
  MAX: 15,
  WEIGHTS: [.1, 2, 2, 1, .4, .2, .04, .03, .02, .02, .01]
};
SUBDIVISIONS = {
  MIN: 0,
  MAX: 7,
  WEIGHTS: [.4, 4, 3, .04, .02, .01]
};
COMPOSERS = [
  // { type: 'scale', name: 'major', root: 'C', return: 'new ScaleComposer(this.name, this.root)' },
  // { type: 'chordProgression', progression: ['Cmaj7', 'Dm', 'G', 'Cmaj7'], return: 'new ChordComposer(this.progression)' },
  // { type: 'mode', name: 'ionian', root: 'C', return: 'new ModeComposer(this.name, this.root)' },
  { type: 'randomScale', return: 'new RandomScaleComposer()' },
  { type: 'randomChordProgression', return: 'new RandomChordComposer()' },
  { type: 'randomMode', return: 'new RandomModeComposer()' }
];
SILENT_OUTRO_SECONDS = 5;
