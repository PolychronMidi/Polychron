"use strict";
// @ts-check
// composers/index.js - Modular composer system
// This file organizes composer classes into logical modules while maintaining backward compatibility
// Base class
// MeasureComposer is at: ./MeasureComposer.js
// Scale-based composers
// ScaleComposer and RandomScaleComposer at: ./ScaleComposer.js
// Chord progression system
// ChordComposer, RandomChordComposer at: ./ChordComposer.js
// ProgressionGenerator at: ./ProgressionGenerator.js
// Modal composers
// ModeComposer, RandomModeComposer at: ./ModeComposer.js
// Pentatonic composers
// PentatonicComposer, RandomPentatonicComposer at: ./PentatonicComposer.js
// Advanced composers (in main composers.js for now)
// TensionReleaseComposer
// ModalInterchangeComposer
// HarmonicRhythmComposer
// MelodicDevelopmentComposer
// AdvancedVoiceLeadingComposer
// ComposerFactory creates instances
/**
 * Centralized factory for composer creation
 * @class
 */
class ComposerFactory {
    /**
     * Creates a composer instance from a config entry.
     * @param {{ type?: string, name?: string, root?: string, progression?: string[], key?: string, quality?: string, tensionCurve?: number, primaryMode?: string, borrowProbability?: number }} config
     * @returns {MeasureComposer}
     */
    static create(config = {}) {
        const type = config.type || 'scale';
        const factory = this.constructors[type];
        if (!factory) {
            console.warn(`Unknown composer type: ${type}. Falling back to random scale.`);
            return this.constructors.scale({ name: 'random', root: 'random' });
        }
        return factory(config);
    }
}
ComposerFactory.constructors = {
    measure: () => new MeasureComposer(),
    scale: ({ name = 'major', root = 'C' } = {}) => {
        const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
        const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
        return new ScaleComposer(n, r);
    },
    chords: ({ progression = ['C'] } = {}) => {
        let p = progression;
        if (progression === 'random') {
            const len = ri(2, 5);
            p = [];
            for (let i = 0; i < len; i++) {
                p.push(allChords[ri(allChords.length - 1)]);
            }
        }
        return new ChordComposer(p);
    },
    mode: ({ name = 'ionian', root = 'C' } = {}) => {
        const n = name === 'random' ? allModes[ri(allModes.length - 1)] : name;
        const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
        return new ModeComposer(n, r);
    },
    pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
        const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
        const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
        return new PentatonicComposer(r, t);
    },
    tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) => new TensionReleaseComposer(key, quality, tensionCurve),
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => new ModalInterchangeComposer(key, primaryMode, borrowProbability),
    harmonicRhythm: ({ progression = ['I', 'IV', 'V', 'I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) => new HarmonicRhythmComposer(progression, key, measuresPerChord, quality),
    melodicDevelopment: ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) => new MelodicDevelopmentComposer(name, root, developmentIntensity),
    advancedVoiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => new AdvancedVoiceLeadingComposer(name, root, commonToneWeight),
};
/**
 * Instantiates all composers from COMPOSERS config.
 * @type {MeasureComposer[]}
 */
let composers = []; // Lazy-loaded in play.js when all systems are ready
//# sourceMappingURL=index.js.map