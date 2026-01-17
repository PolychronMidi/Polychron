// test/structure.test.ts - Testing section type selection
import '../src/sheet.js'; // Load config constants to globalThis
import { selectSectionType, resolveSectionProfile } from '../src/structure.js';

// SECTION_TYPES is accessed via globalThis in structure.ts
const SECTION_TYPES = () => (globalThis as any).SECTION_TYPES;
const PHRASES_PER_SECTION = () => (globalThis as any).PHRASES_PER_SECTION;

describe('Section type selection', () => {
  const originalTypes = SECTION_TYPES() ? JSON.parse(JSON.stringify(SECTION_TYPES())) : null;

  afterAll(() => {
    if (originalTypes && SECTION_TYPES()) {
      SECTION_TYPES().length = 0;
      originalTypes.forEach((t: any) => SECTION_TYPES().push(t));
    }
  });

  it('selectSectionType normalizes fields', () => {
    if (!SECTION_TYPES()) {
      (globalThis as any).SECTION_TYPES = [];
    }
    SECTION_TYPES().length = 0;
    SECTION_TYPES().push({ type: 'intro', weight: 1, phrases: { min: 2, max: 2 }, bpmScale: 0.9, dynamics: 'pp' });
    const picked = selectSectionType();
    expect(picked.type).toBe('intro');
    expect(picked.phrasesMin).toBe(2);
    expect(picked.phrasesMax).toBe(2);
    expect(picked.bpmScale).toBeCloseTo(0.9);
  });

  it('resolveSectionProfile respects explicit range', () => {
    const profile = resolveSectionProfile({ type: 'development', phrases: { min: 3, max: 3 }, bpmScale: 1.1, dynamics: 'f' });
    expect(profile.phrasesPerSection).toBe(3);
    expect(profile.bpmScale).toBeCloseTo(1.1);
    expect(profile.dynamics).toBe('f');
  });

  it('resolveSectionProfile falls back to PHRASES_PER_SECTION bounds', () => {
    if (!SECTION_TYPES()) {
      (globalThis as any).SECTION_TYPES = [];
    }
    SECTION_TYPES().length = 0;
    const profile = resolveSectionProfile();
    expect(profile.phrasesPerSection).toBeGreaterThanOrEqual(PHRASES_PER_SECTION().min);
    expect(profile.phrasesPerSection).toBeLessThanOrEqual(PHRASES_PER_SECTION().max);
  });
});
