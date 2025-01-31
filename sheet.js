primaryInstrument='glockenspiel';
secondaryInstrument='music box';
otherInstruments=[79,98,104,112,114,119,120,121,...Array.from({length: 6},(_,i)=>i + 9)];
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
BPM=80;
NUMERATOR={
  min: 2,
  max: 11,
  weights: [10,20,30,40,20,10,5,1]
};
DENOMINATOR={
  min: 3,
  max: 11,
  weights: [10,20,30,40,20,10,5,1]
};
OCTAVE={
  min: 0,
  max: 8,
  weights: [11,27,33,35,33,35,30,7,3]
};
VOICES={
  min: 0,
  max: 7,
  weights: [15,30,25,7,4,3,2,1]
};
// TODO: implement motifs & section types (introduction,exposition,development,conclusion,fugue).
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
COMPOSERS=[
  // { type: 'scale',name: 'major',root: 'C',return: 'new ScaleComposer(this.name,this.root)' },
  // { type: 'chords',progression: ['Cmaj7','Dm','G','Cmaj7'],return: 'new ChordComposer(this.progression)' },
  // { type: 'mode',name: 'ionian',root: 'C',return: 'new ModeComposer(this.name,this.root)' },
  { type: 'randomScale',return: 'new RandomScaleComposer()' },
  { type: 'randomChords',return: 'new RandomChordComposer()' },
  { type: 'randomMode',return: 'new RandomModeComposer()' }
];
SILENT_OUTRO_SECONDS=5;
