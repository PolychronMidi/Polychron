"use strict";
// structure.js - Section type helpers for per-section shaping.
// minimalist comments, details at: sheet.md / play.md
require('./backstage');
require('./sheet');
const normalizeSectionType = (entry = {}) => {
    const phrases = entry.phrases || entry.phrasesPerSection || PHRASES_PER_SECTION || { min: 1, max: 1 };
    const min = typeof phrases.min === 'number' ? phrases.min : Array.isArray(phrases) ? phrases[0] : PHRASES_PER_SECTION.min;
    const max = typeof phrases.max === 'number' ? phrases.max : Array.isArray(phrases) ? phrases[1] ?? phrases[0] : PHRASES_PER_SECTION.max;
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
const selectSectionType = () => {
    const types = Array.isArray(SECTION_TYPES) && SECTION_TYPES.length ? SECTION_TYPES : [{ type: 'default' }];
    const normalized = types.map(normalizeSectionType);
    const totalWeight = normalized.reduce((sum, t) => sum + (t.weight || 0), 0) || 1;
    let pick = rf(0, totalWeight);
    for (const type of normalized) {
        pick -= (type.weight || 0);
        if (pick <= 0)
            return type;
    }
    return normalized[0];
};
const resolveSectionProfile = (sectionType = null) => {
    const type = sectionType ? normalizeSectionType(sectionType) : normalizeSectionType(selectSectionType());
    const phrasesPerSection = ri(type.phrasesMin, type.phrasesMax);
    return {
        type: type.type,
        phrasesPerSection,
        bpmScale: type.bpmScale,
        dynamics: type.dynamics,
        motif: type.motif || null
    };
};
// Expose globally for play.js and tests
globalThis.normalizeSectionType = normalizeSectionType;
globalThis.selectSectionType = selectSectionType;
globalThis.resolveSectionProfile = resolveSectionProfile;
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, {
        normalizeSectionType,
        selectSectionType,
        resolveSectionProfile,
    });
}
module.exports = { normalizeSectionType, selectSectionType, resolveSectionProfile };
//# sourceMappingURL=structure.js.map