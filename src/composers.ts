// composers.ts - Re-export composers as named exports from the composers module
// Import composers module (which now provides named exports)
import {
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
  ComposerFactory
} from './composers/index.js';



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
  ComposerFactory
};
