"use strict";
// play.ts - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializePlayEngine = void 0;
// Import all dependencies in correct order
require("./sheet"); // Constants and configuration
require("./venue"); // Music theory (scales, chords)
require("./backstage"); // Utilities and global state
require("./writer"); // Output functions
require("./time"); // Timing functions
require("./composers"); // Composer classes
require("./motifs"); // Motif generation
require("./rhythm"); // Rhythm generation
require("./fxManager"); // FX processing
require("./stage.js"); // Audio processing (original JS file)
require("./structure"); // Section structure
// Initialize the composition engine
const initializePlayEngine = () => {
    const g = globalThis;
    const BASE_BPM = g.BPM;
    // Initialize composers from configuration if not already done
    if (!g.composers || g.composers.length === 0) {
        g.composers = g.COMPOSERS.map((config) => g.ComposerFactory.create(config));
    }
    const { state: primary, buffer: c1 } = g.LM.register('primary', 'c1', {}, () => g.stage.setTuningAndInstruments());
    const { state: poly, buffer: c2 } = g.LM.register('poly', 'c2', {}, () => g.stage.setTuningAndInstruments());
    g.totalSections = g.ri(g.SECTIONS.min, g.SECTIONS.max);
    for (g.sectionIndex = 0; g.sectionIndex < g.totalSections; g.sectionIndex++) {
        const sectionProfile = g.resolveSectionProfile();
        g.phrasesPerSection = sectionProfile.phrasesPerSection;
        g.currentSectionType = sectionProfile.type;
        g.currentSectionDynamics = sectionProfile.dynamics;
        g.BPM = g.m.max(1, g.m.round(BASE_BPM * sectionProfile.bpmScale));
        g.activeMotif = sectionProfile.motif
            ? new g.Motif(sectionProfile.motif.map((offset) => ({ note: g.clampMotifNote(60 + offset) })))
            : null;
        for (g.phraseIndex = 0; g.phraseIndex < g.phrasesPerSection; g.phraseIndex++) {
            g.composer = g.ra(g.composers);
            [g.numerator, g.denominator] = g.composer.getMeter();
            g.getMidiTiming();
            g.getPolyrhythm();
            g.LM.activate('primary', false);
            g.setUnitTiming('phrase');
            for (g.measureIndex = 0; g.measureIndex < g.measuresPerPhrase; g.measureIndex++) {
                g.measureCount++;
                g.setUnitTiming('measure');
                for (g.beatIndex = 0; g.beatIndex < g.numerator; g.beatIndex++) {
                    g.beatCount++;
                    g.setUnitTiming('beat');
                    g.stage.setOtherInstruments();
                    g.stage.setBinaural();
                    g.stage.setBalanceAndFX();
                    g.playDrums();
                    g.stage.stutterFX(g.flipBin ? g.flipBinT3 : g.flipBinF3);
                    g.stage.stutterFade(g.flipBin ? g.flipBinT3 : g.flipBinF3);
                    g.rf() < 0.05 ? g.stage.stutterPan(g.flipBin ? g.flipBinT3 : g.flipBinF3) : g.stage.stutterPan(g.stutterPanCHs);
                    for (g.divIndex = 0; g.divIndex < g.divsPerBeat; g.divIndex++) {
                        g.setUnitTiming('division');
                        for (g.subdivIndex = 0; g.subdivIndex < g.subdivsPerDiv; g.subdivIndex++) {
                            g.setUnitTiming('subdivision');
                            g.stage.playNotes();
                        }
                        for (g.subsubdivIndex = 0; g.subsubdivIndex < g.subsubsPerSub; g.subsubdivIndex++) {
                            g.setUnitTiming('subsubdivision');
                            g.stage.playNotes2();
                        }
                    }
                }
            }
            g.LM.advance('primary', 'phrase');
            g.LM.activate('poly', true);
            g.getMidiTiming();
            g.setUnitTiming('phrase');
            for (g.measureIndex = 0; g.measureIndex < g.measuresPerPhrase; g.measureIndex++) {
                g.setUnitTiming('measure');
                for (g.beatIndex = 0; g.beatIndex < g.numerator; g.beatIndex++) {
                    g.setUnitTiming('beat');
                    g.stage.setOtherInstruments();
                    g.stage.setBinaural();
                    g.stage.setBalanceAndFX();
                    g.playDrums2();
                    g.stage.stutterFX(g.flipBin ? g.flipBinT3 : g.flipBinF3);
                    g.stage.stutterFade(g.flipBin ? g.flipBinT3 : g.flipBinF3);
                    g.rf() < 0.05 ? g.stage.stutterPan(g.flipBin ? g.flipBinT3 : g.flipBinF3) : g.stage.stutterPan(g.stutterPanCHs);
                    for (g.divIndex = 0; g.divIndex < g.divsPerBeat; g.divIndex++) {
                        g.setUnitTiming('division');
                        for (g.subdivIndex = 0; g.subdivIndex < g.subdivsPerDiv; g.subdivIndex++) {
                            g.setUnitTiming('subdivision');
                            g.stage.playNotes();
                        }
                        for (g.subsubdivIndex = 0; g.subsubdivIndex < g.subsubsPerSub; g.subsubdivIndex++) {
                            g.setUnitTiming('subsubdivision');
                            g.stage.playNotes2();
                        }
                    }
                }
            }
            g.LM.advance('poly', 'phrase');
        }
        g.LM.advance('primary', 'section');
        g.logUnit('section');
        g.LM.advance('poly', 'section');
        g.logUnit('section');
        g.BPM = BASE_BPM;
        g.activeMotif = null;
    }
    g.grandFinale();
};
exports.initializePlayEngine = initializePlayEngine;
// Also expose to global for backward compatibility
globalThis.initializePlayEngine = initializePlayEngine;
// Execute immediately when module is loaded
initializePlayEngine();
//# sourceMappingURL=play.js.map