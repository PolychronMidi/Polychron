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
  max: 3,
  weights: [15,30,25,7,.5,.5,.1,.1]
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
COMPOSER_FAMILIES={
  diatonicCore: {
    weight: 3,
    types: ['measure', 'scale', 'mode', 'pentatonic', 'voiceLeading']
  },
  harmonicMotion: {
    weight: 3,
    types: ['chords', 'harmonicRhythm', 'tensionRelease', 'modalInterchange']
  },
  development: {
    weight: 2,
    types: ['melodicDevelopment', 'mode', 'voiceLeading', 'scale']
  },
  tonalExploration: {
    weight: 2,
    types: ['mode', 'modalInterchange', 'pentatonic', 'scale']
  },
  rhythmicDrive: {
    weight: 2,
    types: ['measure', 'harmonicRhythm', 'tensionRelease', 'melodicDevelopment']
  }
};
STUTTER_PROFILES={
  source: { perProb: 0.07 },
  reflection: { perProb: 0.2 },
  bass: { perProb: 0.7 }
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

// Modal borrowing options for ModalInterchangeComposer (parallel mode relationships)
MODAL_BORROWING = {
  major: ['minor', 'dorian', 'mixolydian', 'lydian'],
  minor: ['major', 'dorian', 'phrygian', 'locrian']
};

// Centralized profile definitions (authoritative config; modules should delegate here)
VOICE_PROFILES = {
  default: { baseVelocity: 90 },
  soft: { baseVelocity: 70 },
  loud: { baseVelocity: 110 },
  expressive: { baseVelocity: 100 },
  whisper: { baseVelocity: 55 },
  corpusAdaptive: {
    baseVelocity: 88,
    useCorpusVoiceLeadingPriors: true,
    corpusVoiceLeadingStrength: 0.9,
    useCorpusMelodicPriors: true,
    corpusMelodicStrength: 0.85
  }
};

CHORD_PROFILES = {
  pop: { voices: 4, velocityScale: 1, inversion: 0, baseVelocity: 100, useCorpusHarmonicPriors: false },
  jazz: { voices: 4, velocityScale: 0.9, inversion: 1, baseVelocity: 90, useCorpusHarmonicPriors: false },
  ambient: { voices: 3, velocityScale: 0.6, inversion: 0, baseVelocity: 70, useCorpusHarmonicPriors: false },
  classical: { voices: 4, velocityScale: 0.85, inversion: 2, baseVelocity: 85, useCorpusHarmonicPriors: false },
  power: { voices: 2, velocityScale: 1.15, inversion: 0, baseVelocity: 108, useCorpusHarmonicPriors: false },
  corpusAdaptive: { voices: 4, velocityScale: 0.95, inversion: 1, baseVelocity: 92, useCorpusHarmonicPriors: true, corpusHarmonicStrength: 0.62 }
};

MOTIF_PROFILES = {
  default: { velocityScale: 1, timingOffset: 0 },
  sparse: { velocityScale: 0.8, timingOffset: 0.1 },
  dense: { velocityScale: 1.2, timingOffset: -0.05 },
  percussive: { velocityScale: 1.35, timingOffset: -0.08 },
  legato: { velocityScale: 0.9, timingOffset: 0.06 }
};

RHYTHM_PROFILES = {
  straight: { swing: 0, velocityScale: 1 },
  swung: { swing: 0.2, velocityScale: 1 },
  laidBack: { swing: 0.15, velocityScale: 0.9 },
  pushed: { swing: 0.05, velocityScale: 1.1 },
  triplet: { swing: 0.3, velocityScale: 0.95 },
  corpusAdaptive: { swing: 0.12, velocityScale: 1, useCorpusRhythmPriors: true, corpusRhythmStrength: 0.72 }
};
SILENT_OUTRO_SECONDS=5;
