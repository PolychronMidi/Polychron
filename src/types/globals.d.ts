// Auto-generated comprehensive project global declarations for TypeScript checkJs
// These intentionally use `any` for quick onboarding; we can tighten selectively with JSDoc.

// Math & random helpers
declare var m: any;
declare var rf: any;
declare var ri: any;
declare var rw: any;
declare var ra: any;
declare var rv: any;
declare var rl: any;
declare var rd: any;
declare var rlc: any;

// Backstage utils & clamps
declare var clamp: any;
declare var modClamp: any;
declare var lowModClamp: any;
declare var highModClamp: any;
declare var scaleClamp: any;
declare var scaleBoundClamp: any;
declare var softClamp: any;
declare var clampSoft: any;
declare var stepClamp: any;
declare var clampStep: any;
declare var logClamp: any;
declare var clampLog: any;
declare var expClamp: any;
declare var clampExp: any;

// Random helpers
declare var randomFloat: any;
declare var randomInt: any;
declare var randomWeightedInRange: any;
declare var randomWeightedInArray: any;
declare var randomWeightedSelection: any;
declare var randomInRangeOrArray: any;
declare var randomLimitedChange: any;
declare var randomVariation: any;
declare var normalizeWeights: any;
declare var rv: any;

// Timing / meters
declare var bpmRatio: any;
declare var bpmRatio2: any;
declare var bpmRatio3: any;
declare var BPM: any;
declare var PPQ: any;
declare var tpSec: any;
declare var tpMeasure: any;
declare var tpBeat: any;
declare var tpDiv: any;
declare var tpSubdiv: any;
declare var tpSubsubdiv: any;

declare var numerator: any;
declare var denominator: any;
declare var meterRatio: any;

// Rhythm tracking
declare var beatRhythm: any;
declare var divRhythm: any;
declare var subdivRhythm: any;
declare var subsubdivRhythm: any;

declare var sectionIndex: any;
declare var phraseIndex: any;
declare var measureIndex: any;
declare var beatIndex: any;
declare var divIndex: any;
declare var subdivIndex: any;
declare var subsubdivIndex: any;

declare var RhythmRegistry: any;
declare var RhythmManager: any;
declare var RhythmValues: any;
declare var rhythmConfig: any;
declare var rhythmModulator: any;
declare var PhaseLockedRhythmGenerator: any;
declare var FXFeedbackListener: any;
declare var EventBus: any;

// Structure / counters
declare var totalSections: any;
declare var phrasesPerSection: any;
declare var measureCount: any;
declare var measuresPerPhrase: any;
declare var measuresPerPhrase1: any;
declare var measuresPerPhrase2: any;
declare var measureStart: any;
declare var measureStartTime: any;
declare var beatStart: any;
declare var beatStartTime: any;

// Buffer/Layer
declare var c: any;
declare var c1: any;
declare var c2: any;
declare var CSVBuffer: any;
declare var LM: any;
declare var layerManager: any;
declare var TimingContext: any;

// Configuration
declare var TUNING_FREQ: any;
declare var LOG: any;
// Stutter subsystem shared config & metrics
declare var StutterConfig: any;
declare var StutterConfigStore: any;
declare var StutterMetrics: any;
declare var StutterRegistry: any;
// Note cascade helper (schedules note events across unit levels)
declare var noteCascade: any;
declare var normalizeChordSymbol: any;
declare var writeDebugFile: any;
declare var playNotes: any;
declare var BINAURAL: any;
declare var SILENT_OUTRO_SECONDS: any;
declare var SECTIONS: any;
declare var PHRASES_PER_SECTION: any;
declare var NUMERATOR: any;
declare var DENOMINATOR: any;
declare var MEASURES_PER_PHRASE: any;
declare var DIVISIONS: any;
declare var SUBDIVS: any;
declare var SUBSUBDIVISIONS: any;
declare var VOICES: any;
declare var OCTAVE: any;
declare var COMPOSER_TYPES: any;
declare var DYNAMISM: any;
declare var STUTTER_PROBABILITIES: any;
declare var STUTTER_PROFILES: any;
declare var STUTTER_VELOCITY_RANGES: any;
declare var VOICE_Manager: any;

// Instruments & MIDI
declare var primaryInstrument: any;
declare var secondaryInstrument: any;
declare var otherInstruments: any;
declare var bassInstrument: any;
declare var bassInstrument2: any;
declare var otherBassInstruments: any;
declare var drumSets: any;
declare var midiData: any;
declare var getMidiValue: any;
declare var allCHs: any;
declare var allNotes: any;
declare var allScales: any;
declare var allChords: any;
declare var allModes: any;

declare var t: any; // tonal

// Channel constants and arrays (from init.js)
declare var cCH1: any;
declare var cCH2: any;
declare var cCH3: any;
declare var cCH4: any;
declare var cCH5: any;
declare var cCH6: any;
declare var lCH1: any;
declare var lCH2: any;
declare var lCH3: any;
declare var lCH4: any;
declare var lCH5: any;
declare var lCH6: any;
declare var rCH1: any;
declare var rCH2: any;
declare var rCH3: any;
declare var rCH4: any;
declare var rCH5: any;
declare var rCH6: any;
declare var drumCH: any;
declare var source: any;
declare var source2: any;
declare var reflection: any;
declare var bass: any;

declare var rlFX: any;

// Balance and FX helpers
declare var _: any;
declare var lBal: any;
declare var rBal: any;
declare var cBal: any;
declare var cBal2: any;
declare var cBal3: any;
declare var refVar: any;
declare var bassVar: any;
declare var balOffset: any;

declare var rl: any;

// Composer types + factories
declare var composer: any;
declare var composers: any;
declare var MeasureComposer: any;
declare var ScaleComposer: any;
declare var RandomScaleComposer: any;
declare var ChordComposer: any;
declare var RandomChordComposer: any;
declare var ModeComposer: any;
declare var RandomModeComposer: any;
declare var TensionReleaseComposer: any;
declare var ModalInterchangeComposer: any;
declare var HarmonicRhythmComposer: any;
declare var MelodicDevelopmentComposer: any;
declare var VoiceLeadingComposer: any;
declare var MotifComposer: any;
declare var Motif: any;
declare var playMotifs: any;
declare var PentatonicComposer: any;
declare var RandomPentatonicComposer: any;
declare var PhraseArcManager: any;
declare var ComposerFactory: any;
declare var HarmonicContext: any;
declare var MotifChain: any;
declare var ProgressionGenerator: any;

declare var ChordRegistry: any;
declare var ChordManager: any;
declare var ChordValues: any;
declare var chordConfig: any;
declare var chordModulator: any;

declare var MotifRegistry: any;
declare var StutterConfig: any;
declare var StutterAsNoteSource: any;
declare var VOICE_PROFILES: any;
declare var CHORD_PROFILES: any;
declare var MOTIF_PROFILES: any;
declare var RHYTHM_PROFILES: any;
declare var MotifManager: any;
declare var MotifValues: any;
declare var motifConfig: any;
declare var motifModulator: any;

declare var VoiceRegistry: any;
declare var VoiceValues: any;
declare var voiceConfig: any;
declare var voiceModulator: any;

// Ambient module declarations for composer side-effect requires (legacy pattern)
// These declare the file paths as modules so `require('./XComposer')` doesn't error
declare module './MeasureComposer' { const x: any; export = x; }
declare module './MeasureComposer.js' { const x: any; export = x; }
declare module './ScaleComposer' { const x: any; export = x; }
declare module './ScaleComposer.js' { const x: any; export = x; }
declare module './ChordComposer' { const x: any; export = x; }
declare module './ChordComposer.js' { const x: any; export = x; }
declare module './ModeComposer' { const x: any; export = x; }
declare module './ModeComposer.js' { const x: any; export = x; }
declare module './PentatonicComposer' { const x: any; export = x; }
declare module './PentatonicComposer.js' { const x: any; export = x; }
declare module './TensionReleaseComposer' { const x: any; export = x; }
declare module './TensionReleaseComposer.js' { const x: any; export = x; }
declare module './ModalInterchangeComposer' { const x: any; export = x; }
declare module './ModalInterchangeComposer.js' { const x: any; export = x; }
declare module './HarmonicRhythmComposer' { const x: any; export = x; }
declare module './HarmonicRhythmComposer.js' { const x: any; export = x; }
declare module './MelodicDevelopmentComposer' { const x: any; export = x; }
declare module './MelodicDevelopmentComposer.js' { const x: any; export = x; }
declare module './VoiceLeadingComposer' { const x: any; export = x; }
declare module './VoiceLeadingComposer.js' { const x: any; export = x; }
declare module './PhraseArcManager' { const x: any; export = x; }
declare module './PhraseArcManager.js' { const x: any; export = x; }

declare var VoiceLeadingScore: any;
declare var VoiceManager: any;
declare var VoiceRegistry: any;
declare var VoiceStrategyRegistry: any;
declare var VoiceManager: any;

// Helpers & debug/test
declare var logGate: any;
declare var getScheduledNotes: any;
declare var __test_playBeat: any;

// Functions & instrumentation
declare var getMidiTiming: any;
declare var setMidiTiming: any;
declare var getPolyrhythm: any;
declare var setUnitTiming: any;
declare var formatTime: any;
declare var setRhythm: any;
declare var trackBeatRhythm: any;
declare var trackDivRhythm: any;
declare var trackSubdivRhythm: any;
declare var trackSubsubdivRhythm: any;
declare var logUnit: any;
declare var p: any;
declare var pushMultiple: any;
declare var grandFinale: any;
declare var fs: any;
declare var setTuningAndInstruments: any;

declare var _rp: any;
declare var _binary: any;
declare var _hex: any;
declare var _onsets: any;
declare var _random: any;
declare var _probability: any;
declare var _euclid: any;
declare var _rotate: any;
declare var rotate: any;

declare var binaural: any;
declare var stutter: any;
declare var note: any;
declare var stutterFade: any;
declare var stutterPan: any;
declare var stutterFX: any;
declare var stutterNotes: any;
declare var resetChannelTracking: any;
declare var stutterFadeCHs: any;
declare var stutterPanCHs: any;

declare var Stutter: any;
declare var setBalanceAndFX: any;
declare var setBinaural: any;

// Noise functions
declare var SimplexNoise: any;
declare var fbm: any;
declare var turbulence: any;
declare var ridged: any;
declare var worley: any;
declare var easeInOut: any;
declare var easingFunctions: any;
declare var noiseFunctions: any;
declare var metaRecursiveEaseNoise: any;
declare var metaRecursiveNoise: any;
declare var metaRecursiveSimplex2D: any;
declare var metaRecursiveFBM: any;
declare var permutation: any;
declare var fade: any;
declare var lerp: any;
declare var grad: any;
declare var perlinNoise: any;

// Noise Manager
declare var defaultSimplex: any;
declare var noiseGenerators: any;
declare var generatorKeys: any;
declare var getNoiseValue: any;
declare var layeredNoise: any;
declare var createNoiseOffset: any;
declare var randomNoiseGenerator: any;
declare var noiseInfluenceMap: any;
declare var createDualAxisNoiseConfig: any;
declare var applyDualAxisNoise: any;
declare var safeApplyNoise: any;
declare var clampNoiseValue: any;
declare var getParameterModulation: any;
declare var smoothNoiseValue: any;
declare var getNoiseProfile: any;
declare var registerNoiseGenerator: any;
declare var applyNoiseToVelocity: any;
declare var applyNoiseToPan: any;
declare var applyNoiseToSustain: any;
declare var applyNoiseToParameter: any;
declare var getNoiseProfileOrFail: any;
declare const NOISE_PROFILES: any;
declare var applyComposerPitchNoise: any;
declare var applyMelodicTranspositionNoise: any;
declare var applyMelodicPivotNoise: any;
declare var applyMelodicDurationNoise: any;
declare var applyVoiceLeadingWeightNoise: any;

declare var OCTAVE: any;

// Audio helpers / state
declare var rlFX: any;
declare var chFX: any;
declare var flipBin: any;
declare var flipBinT: any;
declare var flipBinF: any;
declare var flipBinT3: any;
declare var flipBinF3: any;
declare var flipBinF2: any;
declare var flipBinT2: any;
declare var reflection: any;
declare var reflectionBinaural: any;
declare var reflect: any;
declare var reflect2: any;
declare var source2: any;
declare var binauralL: any;
declare var binauralR: any;
declare var binauralFreqOffset: any;
declare var binauralOffset: any;
declare var binauralPlus: any;
declare var binauralMinus: any;
declare var bassBinaural: any;

// Audio timing state
declare var beatsOn: any;
declare var beatsOff: any;
declare var divsOn: any;
declare var divsOff: any;
declare var subdivsOn: any;
declare var subdivsOff: any;
declare var subsubdivsOn: any;
declare var subsubdivsOff: any;

declare var measureCount: any;
declare var finalTick: any;
declare var finalTime: any;
declare var bestMatch: any;
declare var tpPhrase1: any;
declare var tpPhrase2: any;
declare var subdivsPerBeat: any;
declare var subsubsPerSub: any;
declare var beatsUntilBinauralShift: any;
declare var beatCount: any;
declare var noteCount: any;
declare var balOffset: any;
declare var sideBias: any;
declare var firstLoop: any;
declare var lastCrossMod: any;
declare var activeMotif: any;
declare var currentSectionType: any;
declare var currentSectionDynamics: any;
declare var crossModulation: any;
declare var lastMeter: any;
declare var lastUsedCHs: any;
declare var lastUsedCHs2: any;
declare var lastUsedCHs3: any;
declare var velocity: any;
declare var neutralPitchBend: any;
declare var semitone: any;
declare var tuningPitchBend: any;
declare var FX: any;

// Play-guard / script helpers
declare var LOCK_DIR: any;
declare var LOCK_PATH: any;
declare var FIN_PATH: any;
declare var HEARTBEAT_INTERVAL_MS: any;
declare var STALE_MS: any;
declare var GRACE_MS: any;
declare var isPidAlive: any;
declare var writeLock: any;
declare var acquireLock: any;
declare var releaseLock: any;
declare var main: any;

// Node globals
declare var require: any;
declare var module: any;
declare var exports: any;
declare var __dirname: any;
declare var __filename: any;
declare var process: any;
declare var console: Console;
declare var Buffer: any;
declare var setTimeout: any;
declare var clearTimeout: any;
declare var setInterval: any;
declare var clearInterval: any;
declare var setImmediate: any;
declare var clearImmediate: any;

// Misc helpers
declare var resolveSectionProfile: any;
declare var selectSectionType: any;
declare var normalizeSectionType: any;
declare var _origRf: any;
declare var _origRv: any;
declare var _origRi: any;

declare var subdivStart: any;
declare var allNotesOff: any;
declare var COMPOSERS: any;
declare var SUBSUBDIVS: any;
declare var applyMotifToNotes: any;
declare var MotifSpreader: any;
