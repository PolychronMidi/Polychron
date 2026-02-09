// config.js - Configuration system with musical parameters and structural settings.

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
  max: 9,
  weights: [11,27,33,35,33,35,30,7,3]
};
VOICES={
  min: 1,
  max: 7,
  weights: [15,30,25,7,1,1,1,1]
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
  min: 1,
  max: 15,
  weights: [1,15,20,25,20,10,10,7,2,2,1]
};
SUBDIVS={
  min: 1,
  max: 15,
  weights: [5,10,20,15,20,10,20,4,2,1,1,1,1]
};
SUBSUBDIVS={
  min: 1,
  max: 15,
  weights: [5,20,30,20,3,5,1,1,1,1]
};
DYNAMISM={
  scaleBase: 0.75,
  scaleRange: 0.5,
  playProb: { start: 0.15, mid: 0.2 },
  stutterProb: { end: 0.4, mid: 0.2 }
};
STUTTER_PROBABILITIES={
  globalApplyProb: 0.2,
  perProb: { source: 0.07, reflection: 0.2, bass: 0.7 },
  shiftProb: { source: 0.15, reflection: 0.7, bass: 0.5 }
};
STUTTER_PROFILES={
  source: { perProb: 0.07, shiftProb: 0.15 },
  reflection: { perProb: 0.2, shiftProb: 0.7 },
  bass: { perProb: 0.7, shiftProb: 0.5 }
};
STUTTER_VELOCITY_RANGES = {
  source: { primary: [0.3, 0.7], secondary: [0.45, 0.8] },
  reflection: { primary: [0.25, 0.65], secondary: [0.4, 0.75] },
  bass: { primary: [0.55, 0.85], secondary: [0.75, 1.05] }
};

NOISE_PROFILES = {
  subtle: {
    generatorX: 'simplex',
    generatorY: 'perlin',
    influenceX: 0.15,
    influenceY: 0.12
  },
  moderate: {
    generatorX: null,
    generatorY: null,
    influenceX: null,
    influenceY: null
  },
  dramatic: {
    generatorX: ['fbm', 'turbulence', 'metaSimplex2D'],
    generatorY: ['metaFBM', 'worley', 'ridged'],
    influenceX: { min: 0.6, max: 0.95 },
    influenceY: { min: 0.6, max: 0.95 }
  },
  chaotic: {
    generatorX: null,
    generatorY: null,
    influenceX: { min: 0.8, max: 1.0 },
    influenceY: { min: 0.8, max: 1.0 }
  }
};

VOICE_Manager = {
  voiceIndependenceDefault: 0.5, // 0-1 scale (contrapuntal vs homophonic)
  arcDensityChance: 0.5,         // Probability of applying arc density multiplier
  arcRegisterBiasChance: 0.3,    // Probability of applying arc register bias
  arcRegisterBiasThreshold: 5    // Minimum semitone shift to trigger arc bias
};

// Centralized profile definitions (authoritative config; modules should delegate here)
VOICE_PROFILES = {
  default: { baseVelocity: 90 },
  soft: { baseVelocity: 70 },
  loud: { baseVelocity: 110 }
};

CHORD_PROFILES = {
  pop: { voices: 4, velocityScale: 1, inversion: 0, baseVelocity: 100 },
  jazz: { voices: 4, velocityScale: 0.9, inversion: 1, baseVelocity: 90 },
  ambient: { voices: 3, velocityScale: 0.6, inversion: 0, baseVelocity: 70 }
};

MOTIF_PROFILES = {
  default: { velocityScale: 1, timingOffset: 0 },
  sparse: { velocityScale: 0.8, timingOffset: 0.1 },
  dense: { velocityScale: 1.2, timingOffset: -0.05 }
};

RHYTHM_PROFILES = {
  straight: { swing: 0, velocityScale: 1 },
  swung: { swing: 0.2, velocityScale: 1 },
  laidBack: { swing: 0.15, velocityScale: 0.9 }
};

COMPOSERS=[
  { type: 'scale', name: 'major', root: 'random' },
  { type: 'chords', progression: 'random' },
  { type: 'mode', name: 'ionian', root: 'random' },
  { type: 'scale', name: 'random', root: 'random' },
  { type: 'scale', name: 'major', root: 'random' },
  { type: 'chords', progression: 'random' },
  { type: 'mode', name: 'ionian', root: 'random' },
  { type: 'mode', name: 'random', root: 'random' },
  { type: 'pentatonic', root: 'random', scaleType: 'random' },
  { type: 'pentatonic', root: 'random', scaleType: 'random' },
  { type: 'tensionRelease', quality: 'major', tensionCurve: 0.6 },
  { type: 'modalInterchange', primaryMode: 'major', borrowProbability: 0.3 },
  // Melodic Development Composers
  { type: 'melodicDevelopment', name: 'major', root: 'random', intensity: 0.6 },
  { type: 'melodicDevelopment', name: 'major', root: 'random', intensity: 0.4 },
  { type: 'melodicDevelopment', name: 'random', root: 'random', intensity: 0.5 },
  { type: 'melodicDevelopment', name: 'random', root: 'random', intensity: 0.7 },
  // Advanced Voice Leading Composers
  { type: 'voiceLeading', name: 'major', root: 'random', commonToneWeight: 0.7 },
  { type: 'voiceLeading', name: 'major', root: 'random', commonToneWeight: 0.5 },
  { type: 'voiceLeading', name: 'random', root: 'random', commonToneWeight: 0.6 },
  { type: 'voiceLeading', name: 'random', root: 'random', commonToneWeight: 0.8 },
  // Harmonic Rhythm (limited to avoid too many drums)
  { type: 'harmonicRhythm', progression: ['I','IV','V','I'], key: 'random', measuresPerChord: 2, quality: 'major' }
];
SILENT_OUTRO_SECONDS=5;
