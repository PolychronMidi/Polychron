// composers.ts - Stub that re-exports from composers/index.ts
// This stub allows downstream modules like play.ts and stage.ts to import from .ts

// Import the TypeScript module from composers directory
import './composers/index';

// Re-export all composers classes and functions from global scope
export const MeasureComposer = (globalThis as any).MeasureComposer;
export const ScaleComposer = (globalThis as any).ScaleComposer;
export const ChordComposer = (globalThis as any).ChordComposer;
export const ModeComposer = (globalThis as any).ModeComposer;
export const PentatonicComposer = (globalThis as any).PentatonicComposer;
export const ComposerFactory = (globalThis as any).ComposerFactory;
export const Composer = (globalThis as any).Composer;
