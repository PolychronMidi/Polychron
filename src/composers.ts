// composers.ts - Re-export composers as named exports from the composers module
// Import composers module (which now provides named exports)
import ScaleComposer from './composers/ScaleComposer.js';
import {
  MeasureComposer,
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
} from './composers/index.js';



// Re-export named composers for consumers



// Re-export named composers for consumers
export {
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
