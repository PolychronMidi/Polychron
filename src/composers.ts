// composers.ts - Stub that re-exports from composers/index.ts
// This stub allows downstream modules like play.ts and stage.ts to import from .ts

// Import the TypeScript module from composers directory
import './composers/index.js';

// Import the new ComposerRegistry
import './ComposerRegistry.js';

// Re-export all composers classes and functions from global scope
const g = globalThis as any;
export const MeasureComposer = g.MeasureComposer;
export const ScaleComposer = g.ScaleComposer;
export const ChordComposer = g.ChordComposer;
export const ModeComposer = g.ModeComposer;
export const PentatonicComposer = g.PentatonicComposer;
export const ComposerFactory = g.ComposerFactory; // Legacy support
export const Composer = g.Composer;

// Re-export new typed registry
export const ComposerRegistry = g.ComposerRegistry;
