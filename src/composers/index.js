// Legacy compatibility: ensure naked global `composers` exists for legacy callers.
// TODO: remove this shim once all call sites use the module exports directly.
composers = composers || [];

const MeasureComposer = require('./MeasureComposer');
const { ScaleComposer, RandomScaleComposer } = require('./ScaleComposer');
const { ChordComposer, RandomChordComposer } = require('./ChordComposer');
const { ModeComposer, RandomModeComposer } = require('./ModeComposer');
const { PentatonicComposer, RandomPentatonicComposer } = require('./PentatonicComposer');
const ProgressionGenerator = require('./ProgressionGenerator');
const TensionReleaseComposer = require('./TensionReleaseComposer');
const ModalInterchangeComposer = require('./ModalInterchangeComposer');
const HarmonicRhythmComposer = require('./HarmonicRhythmComposer');
const MelodicDevelopmentComposer = require('./MelodicDevelopmentComposer');
const AdvancedVoiceLeadingComposer = require('./AdvancedVoiceLeadingComposer');

const ComposerFactory = require('./ComposerFactory');

const TestExports = {
  MeasureComposer,
  ScaleComposer,
  RandomScaleComposer,
  ChordComposer,
  RandomChordComposer,
  ModeComposer,
  RandomModeComposer,
  PentatonicComposer,
  RandomPentatonicComposer,
  ProgressionGenerator,
  TensionReleaseComposer,
  ModalInterchangeComposer,
  HarmonicRhythmComposer,
  MelodicDevelopmentComposer,
  AdvancedVoiceLeadingComposer,
  ComposerFactory
};

try { module.exports = Object.assign({ ComposerFactory, TestExports }, { MeasureComposer, ScaleComposer, RandomScaleComposer, ChordComposer, RandomChordComposer, ModeComposer, RandomModeComposer, PentatonicComposer, RandomPentatonicComposer, ProgressionGenerator, TensionReleaseComposer, ModalInterchangeComposer, HarmonicRhythmComposer, MelodicDevelopmentComposer, AdvancedVoiceLeadingComposer }); } catch (e) { /* swallow */ }
