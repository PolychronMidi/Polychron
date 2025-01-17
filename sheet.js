primaryInstrument='glockenspiel';
secondaryInstrument='music box';
tertiaryInstruments = [79, 98, 104, 114, ...Array.from({length: 6}, (_, i) => i + 9)];
LOG='measure';
TUNING_FREQ=432;
BINAURAL={
  min: 8,
  max: 12
};
PPQ=1000;
BPM=80;
NUMERATOR={
  min: 2,
  max: 15,
  weights: [10, 20, 30, 40, 20, 10, 5, 1]
};
DENOMINATOR={
  min: 3,
  max: 11,
  weights: [10, 20, 30, 40, 20, 10, 5, 1]
};
OCTAVE={
  min: 0,
  max: 8,
  weights: [7, 27, 33, 35, 40, 35, 35, 7, 3]
};
VOICES={
  min: 0,
  max: 7,
  weights: [15, 30, 25, 7, 4, 3, 2, 1]
};
// TODO: implement motifs, phrases, sections, and section types (introduction, exposition, development, conclusion, fugue).
// SECTIONS={
//   min: 2,
//   max: 4
// };
// PHRASES_PER_SECTION={
//   min: 2,
//   max: 4
// };
// MEASURES_PER_PHRASE={
//   min: 2,
//   max: 4
// };
MEASURES={
  min: 10,
  max: 20
};
DIVISIONS={
  min: 0,
  max: 12,
  weights: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1]
};
SUBDIVISIONS={
  min: 0,
  max: 12,
  weights: [5, 10, 20, 15, 20, 10, 20, 4, 2, 1]
};
COMPOSERS=[
  { type: 'scale', name: 'major', root: 'C', return: 'new ScaleComposer(this.name, this.root)' },
  { type: 'chordProgression', progression: ['Cmaj7', 'Dm', 'G', 'Cmaj7'], return: 'new ChordComposer(this.progression)' },
  { type: 'mode', name: 'ionian', root: 'C', return: 'new ModeComposer(this.name, this.root)' },
  { type: 'randomScale', return: 'new RandomScaleComposer()' },
  { type: 'randomChord', return: 'new RandomChordComposer()' },
  { type: 'randomMode', return: 'new RandomModeComposer()' }
];
SILENT_OUTRO_SECONDS=5;
