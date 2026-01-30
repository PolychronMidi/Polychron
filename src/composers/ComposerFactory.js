const MeasureComposer = require('./MeasureComposer');
const Scale = require('./ScaleComposer');
const Chord = require('./ChordComposer');
const Mode = require('./ModeComposer');
const Pentatonic = require('./PentatonicComposer');
const TensionRelease = require('./TensionReleaseComposer');
const ModalInterchange = require('./ModalInterchangeComposer');
const HarmonicRhythm = require('./HarmonicRhythmComposer');
const MelodicDevelopment = require('./MelodicDevelopmentComposer');
const AdvancedVoiceLeading = require('./AdvancedVoiceLeadingComposer');

const { writeDebugFile } = require('../debug/logGate');

class ComposerFactory {
  static constructors = {
    measure: () => new MeasureComposer(),
    scale: ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new (Scale.ScaleComposer || Scale)(n, r);
    },
    chords: ({ progression = ['C'] } = {}) => {
      let p = progression;
      if (progression === 'random') {
        const len = ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) p.push(allChords[ri(allChords.length - 1)]);
      }
      return new (Chord.ChordComposer || Chord)(p);
    },
    mode: ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? allModes[ri(allModes.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new (Mode.ModeComposer || Mode)(n, r);
    },
    pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      return new (Pentatonic.PentatonicComposer || Pentatonic)(r, t);
    },
    tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) => new (TensionRelease || TensionRelease)(key, quality, tensionCurve),
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => new (ModalInterchange || ModalInterchange)(key, primaryMode, borrowProbability),
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) => new (HarmonicRhythm || HarmonicRhythm)(progression, key, measuresPerChord, quality),
    melodicDevelopment: ({ name = 'major', root = 'C', intensity = 0.5 } = {}) => new (MelodicDevelopment || MelodicDevelopment)(name, root, intensity),
    advancedVoiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => new (AdvancedVoiceLeading || AdvancedVoiceLeading)(name, root, commonToneWeight),
  };

  static create(config = {}) {
    const type = config.type || 'scale';
    const factory = this.constructors[type];
    if (!factory) {
      try { writeDebugFile('composer-creation.ndjson', { tag: 'unknown-composer-type', type }, 'debug'); } catch (e) { /* swallow */ }
      return this.constructors.scale({ name: 'random', root: 'random' });
    }
    try { writeDebugFile('composer-creation.ndjson', { when: new Date().toISOString(), type, config, action: 'create', stack: (new Error()).stack.split('\n').slice(2).map(s => s.trim()) }); } catch (e) { /* swallow */ }
    return factory(config);
  }
}

try { module.exports = ComposerFactory; } catch (e) { /* swallow */ }
