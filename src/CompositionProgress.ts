// CompositionProgress.ts - Progress tracking types for composition engine

export type CompositionPhase = 'initializing' | 'composing' | 'rendering' | 'complete';

export interface CompositionProgress {
  phase: CompositionPhase;
  progress: number; // 0-100
  sectionIndex?: number;
  totalSections?: number;
  phraseIndex?: number;
  measureIndex?: number;
  message?: string;
}

export type ProgressCallback = (progress: CompositionProgress) => void;
