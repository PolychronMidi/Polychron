// structure.ts - Section type helpers for per-section shaping.
// minimalist comments, details at: sheet.md / play.md

import './backstage.js';
import './sheet.js';

/**
 * Normalized section type
 */
interface NormalizedSectionType {
  type: string;
  weight: number;
  bpmScale: number;
  dynamics: string;
  phrasesMin: number;
  phrasesMax: number;
  motif: number[] | null;
}

/**
 * Section profile resolved from section type
 */
interface SectionProfile {
  type: string;
  phrasesPerSection: number;
  bpmScale: number;
  dynamics: string;
  motif: number[] | null;
}

// Declare global dependencies
declare const PHRASES_PER_SECTION: any;
declare const SECTION_TYPES: any[];
declare const rf: (min: number, max: number) => number;
declare const ri: (min: number, max: number) => number;

/**
 * Normalizes section type entry to consistent format
 */
export const normalizeSectionType = (entry: any = {}): NormalizedSectionType => {
  const g = globalThis as any;
  const phrases = entry.phrases || entry.phrasesPerSection || g.PHRASES_PER_SECTION || { min: 1, max: 1 };
  const min = typeof phrases.min === 'number' ? phrases.min : Array.isArray(phrases) ? phrases[0] : g.PHRASES_PER_SECTION?.min || 1;
  const max = typeof phrases.max === 'number' ? phrases.max : Array.isArray(phrases) ? phrases[1] ?? phrases[0] : g.PHRASES_PER_SECTION?.max || 1;

  return {
    type: entry.type || entry.name || 'section',
    weight: typeof entry.weight === 'number' ? entry.weight : 1,
    bpmScale: typeof entry.bpmScale === 'number' ? entry.bpmScale : 1,
    dynamics: entry.dynamics || 'mf',
    phrasesMin: min,
    phrasesMax: max,
    motif: entry.motif || null
  };
};

/**
 * Selects a random section type based on weights
 */
export const selectSectionType = (): NormalizedSectionType => {
  const g = globalThis as any;
  const types = Array.isArray(g.SECTION_TYPES) && g.SECTION_TYPES.length ? g.SECTION_TYPES : [{ type: 'default' }];
  const normalized = types.map(normalizeSectionType);
  const totalWeight = normalized.reduce((sum: number, t: NormalizedSectionType) => sum + (t.weight || 0), 0) || 1;
  let pick = g.rf(0, totalWeight);

  for (const type of normalized) {
    pick -= (type.weight || 0);
    if (pick <= 0) return type;
  }

  return normalized[0];
};

/**
 * Resolves a section profile from a section type
 */
export const resolveSectionProfile = (sectionType: any = null): SectionProfile => {
  const g = globalThis as any;
  const type = sectionType ? normalizeSectionType(sectionType) : normalizeSectionType(selectSectionType());
  const phrasesPerSection = g.ri(type.phrasesMin, type.phrasesMax);

  return {
    type: type.type,
    phrasesPerSection,
    bpmScale: type.bpmScale,
    dynamics: type.dynamics,
    motif: type.motif || null
  };
};

// Export to global scope for backward compatibility
(globalThis as any).normalizeSectionType = normalizeSectionType;
(globalThis as any).selectSectionType = selectSectionType;
(globalThis as any).resolveSectionProfile = resolveSectionProfile;

// Export for tests
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__POLYCHRON_TEST__ = (globalThis as any).__POLYCHRON_TEST__ || {};
  Object.assign((globalThis as any).__POLYCHRON_TEST__, {
    normalizeSectionType,
    selectSectionType,
    resolveSectionProfile
  });
}
