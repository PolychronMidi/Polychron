"use strict";
// structure.ts - Section type helpers for per-section shaping.
// minimalist comments, details at: sheet.md / play.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSectionProfile = exports.selectSectionType = exports.normalizeSectionType = void 0;
require("./backstage");
require("./sheet");
/**
 * Normalizes section type entry to consistent format
 */
const normalizeSectionType = (entry = {}) => {
    const g = globalThis;
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
exports.normalizeSectionType = normalizeSectionType;
/**
 * Selects a random section type based on weights
 */
const selectSectionType = () => {
    const g = globalThis;
    const types = Array.isArray(g.SECTION_TYPES) && g.SECTION_TYPES.length ? g.SECTION_TYPES : [{ type: 'default' }];
    const normalized = types.map(exports.normalizeSectionType);
    const totalWeight = normalized.reduce((sum, t) => sum + (t.weight || 0), 0) || 1;
    let pick = g.rf(0, totalWeight);
    for (const type of normalized) {
        pick -= (type.weight || 0);
        if (pick <= 0)
            return type;
    }
    return normalized[0];
};
exports.selectSectionType = selectSectionType;
/**
 * Resolves a section profile from a section type
 */
const resolveSectionProfile = (sectionType = null) => {
    const g = globalThis;
    const type = sectionType ? (0, exports.normalizeSectionType)(sectionType) : (0, exports.normalizeSectionType)((0, exports.selectSectionType)());
    const phrasesPerSection = g.ri(type.phrasesMin, type.phrasesMax);
    return {
        type: type.type,
        phrasesPerSection,
        bpmScale: type.bpmScale,
        dynamics: type.dynamics,
        motif: type.motif || null
    };
};
exports.resolveSectionProfile = resolveSectionProfile;
// Export to global scope for backward compatibility
globalThis.normalizeSectionType = exports.normalizeSectionType;
globalThis.selectSectionType = exports.selectSectionType;
globalThis.resolveSectionProfile = exports.resolveSectionProfile;
// Export for tests
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, {
        normalizeSectionType: exports.normalizeSectionType,
        selectSectionType: exports.selectSectionType,
        resolveSectionProfile: exports.resolveSectionProfile
    });
}
//# sourceMappingURL=structure.js.map