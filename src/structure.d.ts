import './backstage';
import './sheet';
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
/**
 * Normalizes section type entry to consistent format
 */
export declare const normalizeSectionType: (entry?: any) => NormalizedSectionType;
/**
 * Selects a random section type based on weights
 */
export declare const selectSectionType: () => NormalizedSectionType;
/**
 * Resolves a section profile from a section type
 */
export declare const resolveSectionProfile: (sectionType?: any) => SectionProfile;
export {};
//# sourceMappingURL=structure.d.ts.map