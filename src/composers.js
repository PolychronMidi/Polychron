// composers.js - Musical intelligence system with meter and composition generation.
// minimalist comments, details at: composers.md

const { writeIndexTrace, writeDebugFile, isEnabled } = require('./debug/logGate');
const MeasureComposer = require('./composers/MeasureComposer');

const { ScaleComposer, RandomScaleComposer } = require('./composers/ScaleComposer');
const { ChordComposer, RandomChordComposer } = require('./composers/ChordComposer');
const { ModeComposer, RandomModeComposer } = require('./composers/ModeComposer');

// Centralized factory for composer creation (avoids eval and keeps config typed)
/**
 * Composes notes from pentatonic scales with specialized voicing.
 * Pentatonics avoid semitone intervals, creating open, consonant harmonies.
 * @extends MeasureComposer
 */
const ProgressionGenerator = require('./composers/ProgressionGenerator');

const TensionReleaseComposer = require('./composers/TensionReleaseComposer');

const ModalInterchangeComposer = require('./composers/ModalInterchangeComposer');

const HarmonicRhythmComposer = require('./composers/HarmonicRhythmComposer');
const MelodicDevelopmentComposer = require('./composers/MelodicDevelopmentComposer');
const AdvancedVoiceLeadingComposer = require('./composers/AdvancedVoiceLeadingComposer');const { PentatonicComposer, RandomPentatonicComposer } = require('./composers/PentatonicComposer');

class ComposerFactory {
  static constructors = {
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
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) => new HarmonicRhythmComposer(progression, key, measuresPerChord, quality),
    melodicDevelopment: ({ name = 'major', root = 'C', intensity = 0.5 } = {}) => new MelodicDevelopmentComposer(name, root, intensity),
    advancedVoiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => new AdvancedVoiceLeadingComposer(name, root, commonToneWeight),
  };

  /**
   * Creates a composer instance from a config entry.
   * @param {{ type?: string, name?: string, root?: string, progression?: string[], key?: string, quality?: string, tensionCurve?: number, primaryMode?: string, borrowProbability?: number }} config
   * @returns {MeasureComposer}
   */
  static create(config = {}) {
    const type = config.type || 'scale';
    const factory = this.constructors[type];
    if (!factory) {
      writeDebugFile('composers.ndjson', { tag: 'unknown-composer-type', type }, 'debug');
      try { writeDebugFile('composer-creation.ndjson', { when: new Date().toISOString(), type, config, action: 'fallback' }); } catch (e) { /* swallow */ }
      return this.constructors.scale({ name: 'random', root: 'random' });
    }
    // Record composer creation for triage
    try { writeDebugFile('composer-creation.ndjson', { when: new Date().toISOString(), type, config, action: 'create', stack: (new Error()).stack.split('\n').slice(2).map(s => s.trim()) }); } catch (e) { /* swallow */ }
    return factory(config);
  }
}

/**
 * Instantiates all composers from COMPOSERS config.
 * @type {MeasureComposer[]}
 */
composers = [];  // Lazy-loaded in play.js when all systems are ready

// Export classes and factory globally for testing
/* self-assigns removed to satisfy lint (classes are already defined in this scope) */



// Export ComposerFactory (and related classes) via CommonJS so modules can require them explicitly
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, {
    ComposerFactory,
    MeasureComposer,
    ScaleComposer,
    ChordComposer,
    // Expose constructors for tests via TestExports to avoid global mutation
    TestExports: { MeasureComposer, ScaleComposer, RandomScaleComposer, ChordComposer, RandomChordComposer, ModeComposer, RandomModeComposer, PentatonicComposer, RandomPentatonicComposer, ProgressionGenerator, TensionReleaseComposer, ModalInterchangeComposer, HarmonicRhythmComposer, MelodicDevelopmentComposer, AdvancedVoiceLeadingComposer, ComposerFactory }
  });
}
