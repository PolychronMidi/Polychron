// sheet.js - Configuration system with musical parameters and structural settings.
// minimalist comments, details at: sheet.md

primaryInstrument='glockenspiel';
secondaryInstrument='music box';
otherInstruments=[9,10,11,12,13,14,79,89,97,98,98,98,104,112,114,119,120,121];
bassInstrument='Acoustic Bass';
bassInstrument2='Synth Bass 2';
otherBassInstruments=[32,33,34,35,36,37,38,39,40,41,43,44,45,46,48,49,50,51,89,98,98,98,98,98,98,98,98,98,98];
drumSets=[0,8,16,24,25,32,40,48,127];
LOG='section,phrase,measure';
TUNING_FREQ=432;
BINAURAL={
  min: 8,
  max: 12
};
PPQ=30000;
BPM=72;
NUMERATOR={
  min: 2,
  max: 20,
  weights: [10,20,30,40,20,10,5,1]
};
DENOMINATOR={
  min: 3,
  max: 20,
  weights: [10,20,30,40,20,10,5,1]
};
OCTAVE={
  min: 0,
  max: 8,
  weights: [11,27,33,35,33,35,30,7,3]
};
VOICES={
  min: 1,
  max: 7,
  weights: [15,30,25,7,4,3,2,1]
};
SECTION_TYPES=[
  { type: 'intro', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: .9, dynamics: 'pp', motif: [0,2,4,7] },
  { type: 'exposition', weight: 3, phrases: { min: 2, max: 3 }, bpmScale: 1, dynamics: 'mf', motif: [0,4,7,12] },
  { type: 'development', weight: 2, phrases: { min: 3, max: 4 }, bpmScale: 1.05, dynamics: 'f', motif: [0,3,5,8,10] },
  { type: 'conclusion', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: .95, dynamics: 'p', motif: [0,5,7,12] },
  { type: 'coda', weight: 1, phrases: { min: 1, max: 1 }, bpmScale: .9, dynamics: 'pp', motif: [0,7,12] }
];
PHRASES_PER_SECTION={
  min: 2,
  max: 4
};
SECTIONS={
  min: 6,
  max: 9
};
DIVISIONS={
  min: 0,
  max: 10,
  weights: [1,15,20,25,20,10,10,7,2,2,1]
};
SUBDIVISIONS={
  min: 0,
  max: 10,
  weights: [5,10,20,15,20,10,20,4,2,1]
};
SUBSUBDIVS={
  min: 0,
  max: 5,
  weights: [5,20,30,20,10,5]
};
COMPOSERS=[
  { type: 'scale', name: 'major', root: 'C' },
  { type: 'chords', progression: ['Cmaj7','Dm','G','Cmaj7'] },
  { type: 'mode', name: 'ionian', root: 'C' },
  { type: 'scale', name: 'random', root: 'C' },
  { type: 'scale', name: 'major', root: 'random' },
  { type: 'chords', progression: 'random' },
  { type: 'mode', name: 'ionian', root: 'random' },
  { type: 'mode', name: 'random', root: 'random' },
  { type: 'pentatonic', root: 'C', scaleType: 'major' },
  { type: 'pentatonic', root: 'random', scaleType: 'random' },
  { type: 'tensionRelease', quality: 'major', tensionCurve: 0.6 },
  { type: 'modalInterchange', primaryMode: 'major', borrowProbability: 0.3 }
];
SILENT_OUTRO_SECONDS=5;
