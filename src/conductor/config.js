// config.js - Central hub of tunable controls and profile tables.

primaryInstrument = getMidiValue('program', 'glockenspiel');
secondaryInstrument = getMidiValue('program', 'music box');
otherInstruments=[9,10,11,12,13,14,79,89,97,98,98,98,104,112,114,119,120,121];
bassInstrument = getMidiValue('program', 'Acoustic Bass');
bassInstrument2 = getMidiValue('program', 'Synth Bass 2');
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
  weights: [11,27,33,35,33,35,30,5,2]
};
BEAT_VOICES = {
  min: 1,
  max: 5,
  weights: [15,30,25,7,0.5,0.5,0.1,0.1]
};

// Per-unit voice limits (child units independent of parent unit counts)
DIV_VOICES = {
  min: 1,
  max: 3,
  weights: [60,10,1]
};

SUBDIV_VOICES = {
  min: 1,
  max: 2,
  weights: [50,1]
};

SUBSUBDIV_VOICES = {
  min: 1,
  max: 2,
  weights: [70,1]
};

// Sibling voice limits per unit level — max unique pitch classes across all siblings.
// Once the sibling limit is reached, remaining siblings reuse from existing PC pool.
// Defaults are roughly 2-3× the per-unit voice count for coherent sibling groups.
BEAT_SIBLING_VOICES = { min: 3, max: 12, weights: [5, 10, 20, 25, 15, 10, 5, 3, 2, 1] };
DIV_SIBLING_VOICES = { min: 2, max: 8, weights: [10, 20, 25, 15, 8, 3, 1] };
SUBDIV_SIBLING_VOICES = { min: 2, max: 6, weights: [15, 25, 20, 10, 3] };
SUBSUBDIV_SIBLING_VOICES = { min: 1, max: 4, weights: [20, 25, 10, 3] };

// Backwards-compatibility alias for older code that still references VOICES
VOICES = BEAT_VOICES;
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

// Cross-modulation rules for stutter ↔ CC interactions. Values are multipliers or biases
// sampled by stutterNotes when beatContext.mod provides per-channel CC intensities.
STUTTER_CROSSMOD_RULES = {
  // pan intensity increases chance of octave motion, widens shift range, and can increase stutter rate
  pan: { stutterProbScale: 1.25, shiftRangeBias: 1, stutterRateScale: 1.25 },
  // fade intensity favors velocity coherence (noisy boost on fade-in)
  fade: { velocityScaleBias: 0.15 },
  // fx intensity increases shift-range sensitivity
  fx: { shiftRangeScale: 1.2 }
};

// Presets and directive-friendly defaults for higher-level coherence directives
STUTTER_PRESETS = {
  default: {
    crossMod: { pan: { stutterRateScale: 1.25, stutterProbScale: 1.2, shiftRangeBias: 1 }, fade: { velocityScaleBias: 0.12 }, fx: { shiftRangeScale: 1.1 } },
    rateCurve: 'linear',
    phaseCurve: 'linear',
    coherence: { enabled: false }
  },
  stereoWide: {
    crossMod: { pan: { stutterRateScale: 1.6, stutterProbScale: 1.4, shiftRangeBias: 2 }, fade: { velocityScaleBias: 0.18 }, fx: { shiftRangeScale: 1.25 } },
    rateCurve: 'sine',
    phaseCurve: 'pingpong',
    coherence: { enabled: true, intensity: 0.9 }
  },
  subtle: {
    crossMod: { pan: { stutterRateScale: 1.05, stutterProbScale: 1.05, shiftRangeBias: 0 }, fade: { velocityScaleBias: 0.06 }, fx: { shiftRangeScale: 1.02 } },
    rateCurve: 'linear',
    phaseCurve: 'linear',
    coherence: { enabled: true, intensity: 0.5 }
  }
};
NOISE_PROFILES = {
  micro: {
    generatorX: 'simplex',
    generatorY: 'simplex',
    influenceX: 0.08,
    influenceY: 0.06
  },
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

MOTIF_UNIT_PROFILES = {
  measure: { density: 0.7, style: 'random', intervalDensity: 0.7, velocityScale: 1.0 },
  beat: { density: 0.6, style: 'random', intervalDensity: 0.6, velocityScale: 0.95 },
  div: { density: 0.5, style: 'random', intervalDensity: 0.5, velocityScale: 0.9 },
  subdiv: { density: 0.4, style: 'random', intervalDensity: 0.4, velocityScale: 0.85 },
  subsubdiv: { density: 0.3, style: 'random', intervalDensity: 0.3, velocityScale: 0.8 }
};

RHYTHM_PROFILES = {
  straight: { swing: 0, velocityScale: 1 },
  swung: { swing: 0.2, velocityScale: 1 },
  laidBack: { swing: 0.15, velocityScale: 0.9 },
  pushed: { swing: 0.05, velocityScale: 1.1 },
  triplet: { swing: 0.3, velocityScale: 0.95 },
  corpusAdaptive: { swing: 0.12, velocityScale: 1, useCorpusRhythmPriors: true, corpusRhythmStrength: 0.72 }
};

STUTTER_CROSSMOD_RULES_FALLBACK = {
  pan: { stutterProbScale: 1.0, shiftRangeBias: 0, stutterRateScale: 1.0 },
  fade: { velocityScaleBias: 0 },
  fx: { shiftRangeScale: 1.0 }
};

STUTTER_DIRECTIVE_DEFAULTS = {
  coherence: { enabled: false, intensity: 0.8, keyPrefix: 'stutter' },
  phase: { left: 0, right: 0.5, center: 0 },
  rateCurve: 'linear',
  phaseCurve: 'linear',
  crossModOverrides: null,
  perProfileRouting: { L1: 'source', L2: 'reflection', defaultWeight: 0.6 },
  metricsAdaptive: { enabled: false, sensitivity: 0.08 }
};

CONDUCTOR_DYNAMICS_CONTROLS = {
  phaseProfileMap: {
    intro: 'restrained',
    opening: 'restrained',
    exposition: 'default',
    development: 'default',
    climax: 'explosive',
    resolution: 'atmospheric',
    conclusion: 'atmospheric',
    coda: 'minimal'
  },
  crossfadeMeasuresDefault: 4,
  regulation: {
    windowSize: 16,
    highThreshold: 0.78,
    lowThreshold: 0.25,
    maxDensityBias: 0.12,
    maxCrossModBias: 0.3,
    adjustRate: 0.02,
    settleDecay: 0.9,
    crossModSampleDivisor: 6
  }
};

MAIN_LOOP_CONTROLS = {
  phraseFamilyBias: {
    phaseAffinity: {
      intro: 'diatonicCore',
      opening: 'diatonicCore',
      development: 'development',
      climax: 'rhythmicDrive',
      resolution: 'harmonicMotion',
      conclusion: 'tonalExploration'
    },
    lockProbability: 0.5
  },
  stutterPanJitterChance: 0.05,
  fxIntensityNormalization: {
    stereoPanDenominator: 45,
    velocityShiftDenominator: 20
  },
  conductorFallback: {
    playProb: 0.5,
    stutterProb: 0.3
  }
};

CONDUCTOR_NOISE_PROFILE_BY_PHASE = {
  intro: 'micro',
  opening: 'subtle',
  exposition: 'subtle',
  development: 'moderate',
  climax: 'dramatic',
  resolution: 'subtle',
  conclusion: 'micro',
  coda: 'micro',
  default: 'subtle'
};

// 1. Centralized FX CC defaults by channel group.
// Keys match the `effectNum` used in setBalanceAndFX.js and can be tuned per group.
FX_CC_DEFAULTS = {
  source: {
    1: { min: 0, max: 60, conditionMin: 0, conditionMax: 10 },
    5: { min: 125, max: 127, conditionMin: 126, conditionMax: 127 },
    11: { min: 64, max: 127, conditionMin: 115, conditionMax: 127 },
    65: { min: 45, max: 64, conditionMin: 35, conditionMax: 64 },
    67: { min: 63, max: 64 },
    68: { min: 63, max: 64 },
    69: { min: 63, max: 64 },
    70: { min: 0, max: 127 },
    71: { min: 0, max: 127 },
    72: { min: 64, max: 127 },
    73: { min: 0, max: 64 },
    74: { min: 80, max: 127 },
    91: { min: 0, max: 33 },
    92: { min: 0, max: 33 },
    93: { min: 0, max: 33 },
    94: { min: 0, max: 5, conditionMin: 0, conditionMax: 64 },
    95: { min: 0, max: 33 }
  },
  reflection: {
    1: { min: 0, max: 90, conditionMin: 0, conditionMax: 15 },
    5: { min: 125, max: 127, conditionMin: 126, conditionMax: 127 },
    11: { min: 77, max: 111, conditionMin: 66, conditionMax: 99 },
    65: { min: 45, max: 64, conditionMin: 35, conditionMax: 64 },
    67: { min: 63, max: 64 },
    68: { min: 63, max: 64 },
    69: { min: 63, max: 64 },
    70: { min: 0, max: 127 },
    71: { min: 0, max: 127 },
    72: { min: 64, max: 127 },
    73: { min: 0, max: 64 },
    74: { min: 80, max: 127 },
    91: { min: 0, max: 77, conditionMin: 0, conditionMax: 32 },
    92: { min: 0, max: 77, conditionMin: 0, conditionMax: 32 },
    93: { min: 0, max: 77, conditionMin: 0, conditionMax: 32 },
    94: { min: 0, max: 64, conditionMin: 0, conditionMax: 11 },
    95: { min: 0, max: 77, conditionMin: 0, conditionMax: 32 }
  },
  bass: {
    1: { min: 0, max: 60, conditionMin: 0, conditionMax: 10 },
    5: { min: 125, max: 127, conditionMin: 126, conditionMax: 127 },
    11: { min: 88, max: 127, conditionMin: 115, conditionMax: 127 },
    65: { min: 45, max: 64, conditionMin: 35, conditionMax: 64 },
    67: { min: 63, max: 64 },
    68: { min: 63, max: 64 },
    69: { min: 63, max: 64 },
    70: { min: 0, max: 127 },
    71: { min: 0, max: 127 },
    72: { min: 64, max: 127 },
    73: { min: 0, max: 64 },
    74: { min: 80, max: 127 },
    91: { min: 0, max: 99, conditionMin: 0, conditionMax: 64 },
    92: { min: 0, max: 99, conditionMin: 0, conditionMax: 64 },
    93: { min: 0, max: 99, conditionMin: 0, conditionMax: 64 },
    94: { min: 0, max: 64, conditionMin: 0, conditionMax: 11 },
    95: { min: 0, max: 99, conditionMin: 0, conditionMax: 64 }
  }
};

// 2. Centralized Noise Generator Registry: Defines available noise types and their implementation keys.
NOISE_GENERATOR_REGISTRY = {
  simplex: 'simplex',
  perlin: 'perlin',
  fbm: 'fbm',
  turbulence: 'turbulence',
  metaSimplex2D: 'metaSimplex2D',
  metaFBM: 'metaFBM',
  worley: 'worley',
  ridged: 'ridged'
};

// 4. Centralized Rhythm Patterns: Defines standard patterns and their weights/generation methods.
RHYTHM_PATTERNS = {
  binary: { weights: [2, 3, 1], method: 'binary', args: (length) => [length] },
  hex: { weights: [2, 3, 1], method: 'hex', args: (length) => [length] },
  onsets: { weights: [5, 0, 0], method: 'onsets', args: (length) => [{ make: [length, () => [1, 2]] }] },
  onsets2: { weights: [0, 2, 0], method: 'onsets', args: (length) => [{ make: [length, [2, 3, 4]] }] },
  onsets3: { weights: [0, 0, 7], method: 'onsets', args: (length) => [{ make: [length, () => [3, 7]] }] },
  random: { weights: [7, 0, 0], method: 'random', args: (length) => [length, 0.2] }, // simplified prob arg
  random2: { weights: [0, 3, 0], method: 'random', args: (length) => [length, 0.3] },
  random3: { weights: [0, 0, 1], method: 'random', args: (length) => [length, 0.3] },
  euclid: { weights: [3, 3, 3], method: 'euclid', args: (length) => {
      // Logic from patterns.js moved here conceptually, but functions like closestDivisor need to be available scope-side or passed in.
      // Keeping simple config args here for now, logic remains in patterns.js to interpret.
      return [length, 'dynamic'];
  }},
  rotate: { weights: [2, 2, 2], method: 'rotate', args: (length, pattern) => [pattern, 2, '?', length] },
  morph: { weights: [2, 3, 3], method: 'morph', args: (length, pattern) => [pattern, '?', length] }
};

// Centralized per-level rhythm key pools used by getRhythm selection.
RHYTHM_PATTERN_POOLS = {
  beat: ['binary', 'hex', 'onsets', 'random', 'euclid', 'rotate', 'morph'],
  div: ['binary', 'hex', 'onsets', 'onsets2', 'random', 'random2', 'euclid', 'rotate', 'morph'],
  subdiv: ['binary', 'hex', 'onsets2', 'onsets3', 'random2', 'random3', 'euclid', 'rotate', 'morph'],
  subsubdiv: ['onsets3', 'random3', 'euclid', 'rotate', 'morph']
};

// Centralized drum map (note + velocity range) used by rhythm/drummer.
DRUM_MAP = {
  snare1: { note: 31, velocityRange: [99, 111] },
  snare2: { note: 33, velocityRange: [99, 111] },
  snare3: { note: 124, velocityRange: [77, 88] },
  snare4: { note: 125, velocityRange: [77, 88] },
  snare5: { note: 75, velocityRange: [77, 88] },
  snare6: { note: 85, velocityRange: [77, 88] },
  snare7: { note: 118, velocityRange: [66, 77] },
  snare8: { note: 41, velocityRange: [66, 77] },
  kick1: { note: 12, velocityRange: [111, 127] },
  kick2: { note: 14, velocityRange: [111, 127] },
  kick3: { note: 0, velocityRange: [99, 111] },
  kick4: { note: 2, velocityRange: [99, 111] },
  kick5: { note: 4, velocityRange: [88, 99] },
  kick6: { note: 5, velocityRange: [88, 99] },
  kick7: { note: 6, velocityRange: [88, 99] },
  cymbal1: { note: 59, velocityRange: [66, 77] },
  cymbal2: { note: 53, velocityRange: [66, 77] },
  cymbal3: { note: 80, velocityRange: [66, 77] },
  cymbal4: { note: 81, velocityRange: [66, 77] },
  conga1: { note: 60, velocityRange: [66, 77] },
  conga2: { note: 61, velocityRange: [66, 77] },
  conga3: { note: 62, velocityRange: [66, 77] },
  conga4: { note: 63, velocityRange: [66, 77] },
  conga5: { note: 64, velocityRange: [66, 77] }
};

// 5. Centralized Phrase Arc Curves: Defines the shape functions for intensity/register over a phrase.
PHRASES_ARC_CURVES = {
  'arch': {
    register: (p) => Math.sin(Number(p) * Math.PI) * 12 - 6,
    density: (p) => Math.sin(Number(p) * Math.PI) * 0.4 + 0.8,
    dynamism: () => 1.0
  },
  'wave': {
    register: (p) => Math.sin(Number(p) * Math.PI * 2) * 8,
    density: (p) => Math.cos(Number(p) * Math.PI) * 0.3 + 0.9,
    dynamism: (p) => 0.8 + Number(p) * 0.4
  },
  'rise-fall': {
    register: (p) => (Number(p) < 0.7 ? Number(p) * 15 : (1 - Number(p)) * 30) - 5,
    density: (p) => Number(p) * 0.5 + 0.5,
    dynamism: (p) => 1.0 + Number(p) * 0.2
  },
  'build-resolve': {
    register: (p) => Number(p) * 24 - 12,
    density: (p) => Number(p) * 0.8 + 0.4,
    dynamism: (p) => 0.5 + Number(p) * 1.0
  }
};

SILENT_OUTRO_SECONDS=5;
