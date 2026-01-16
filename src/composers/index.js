// @ts-check
// composers/index.js - Modular composer system
// This file organizes composer classes into logical modules while maintaining backward compatibility

// Load dependencies
require('../backstage');  // Load global utilities (m, rf, ri, ra, etc.)
require('../venue');      // Load music theory (allScales, allNotes, allModes, allChords)

// Load composer modules (only the ones that exist)
require('./MeasureComposer');
require('./ScaleComposer');
require('./ProgressionGenerator');

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

// Stub composers for missing implementations - these just extend ScaleComposer
class ChordComposer extends ScaleComposer {
  constructor(progression = ['C']) {
    super('major', progression[0] || 'C');
    this.progression = progression;
  }
}

class ModeComposer extends ScaleComposer {
  constructor(name = 'ionian', root = 'C') {
    super(name, root);
  }
}

class PentatonicComposer extends ScaleComposer {
  constructor(root = 'C', scaleType = 'major') {
    super(scaleType === 'major' ? 'major pentatonic' : 'minor pentatonic', root);
  }
}

class TensionReleaseComposer extends ScaleComposer {
  constructor(key = 'C', quality = 'major', tensionCurve = 0.5) {
    super(quality, key);
    this.tensionCurve = tensionCurve;
  }
}

class ModalInterchangeComposer extends ScaleComposer {
  constructor(key = 'C', primaryMode = 'major', borrowProbability = 0.25) {
    super(primaryMode, key);
    this.borrowProbability = borrowProbability;
  }
}

class HarmonicRhythmComposer extends ScaleComposer {
  constructor(progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major') {
    super(quality, key);
    this.progression = progression;
    this.measuresPerChord = measuresPerChord;
  }
}

class MelodicDevelopmentComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', developmentIntensity = 0.5) {
    super(name, root);
    this.developmentIntensity = developmentIntensity;
  }
}

class AdvancedVoiceLeadingComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', commonToneWeight = 0.7) {
    super(name, root);
    this.commonToneWeight = commonToneWeight;
  }
}

// Export stub composers to global scope
globalThis.ChordComposer = ChordComposer;
globalThis.ModeComposer = ModeComposer;
globalThis.PentatonicComposer = PentatonicComposer;
globalThis.TensionReleaseComposer = TensionReleaseComposer;
globalThis.ModalInterchangeComposer = ModalInterchangeComposer;
globalThis.HarmonicRhythmComposer = HarmonicRhythmComposer;
globalThis.MelodicDevelopmentComposer = MelodicDevelopmentComposer;
globalThis.AdvancedVoiceLeadingComposer = AdvancedVoiceLeadingComposer;

// ComposerFactory creates instances

/**
 * Centralized factory for composer creation
 * @class
 */
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
    melodicDevelopment: ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) => new MelodicDevelopmentComposer(name, root, developmentIntensity),
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
      console.warn(`Unknown composer type: ${type}. Falling back to random scale.`);
      return this.constructors.scale({ name: 'random', root: 'random' });
    }
    return factory(config);
  }
}

/**
 * Instantiates all composers from COMPOSERS config.
 * @type {MeasureComposer[]}
 */
let composers = [];  // Lazy-loaded in play.js when all systems are ready

// Export to global scope for backward compatibility
globalThis.ComposerFactory = ComposerFactory;
globalThis.composers = composers;
