// Legacy compatibility: ensure naked global `composers` exists for legacy callers.
// TODO: remove this shim once all call sites use the module exports directly.
// Preserve legacy naked global `composers` without `globalThis` usage
if (typeof composers === 'undefined') composers = [];

require('./MeasureComposer');
require('./ScaleComposer');
require('./ChordComposer');
require('./ModeComposer');
require('./PentatonicComposer');
const ProgressionGenerator = require('./ProgressionGenerator');
const TensionReleaseComposer = require('./TensionReleaseComposer');
const ModalInterchangeComposer = require('./ModalInterchangeComposer');
const HarmonicRhythmComposer = require('./HarmonicRhythmComposer');
const MelodicDevelopmentComposer = require('./MelodicDevelopmentComposer');
const AdvancedVoiceLeadingComposer = require('./AdvancedVoiceLeadingComposer');
require('./MotifComposer');

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
  MotifComposer,
  ComposerFactory
};

/* Components are exposed via their require() side-effects; explicit Function wrappers removed */
