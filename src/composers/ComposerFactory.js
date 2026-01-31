require('./MeasureComposer');
require('./ScaleComposer');
require('./ChordComposer');
require('./ModeComposer');
require('./PentatonicComposer');
require('./TensionReleaseComposer');
require('./ModalInterchangeComposer');
require('./HarmonicRhythmComposer');
require('./MelodicDevelopmentComposer');
require('./AdvancedVoiceLeadingComposer');

ComposerFactory = class ComposerFactory {
  static constructors = {
    measure: () => new MeasureComposer(),
    scale: ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new (ScaleComposer)(n, r);
    },
    chords: ({ progression = ['C'] } = {}) => {
      let p = progression;
      if (progression === 'random') {
        const len = ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) p.push(allChords[ri(allChords.length - 1)]);
      }
      return new (ChordComposer)(p);
    },
    mode: ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? allModes[ri(allModes.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new (ModeComposer)(n, r);
    },
    pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      return new (PentatonicComposer)(r, t);
    },
    tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) => new TensionReleaseComposer(key, quality, tensionCurve),
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => new ModalInterchangeComposer(key, primaryMode, borrowProbability),
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) => new HarmonicRhythmComposer(progression, key, measuresPerChord, quality),
    melodicDevelopment: ({ name = 'major', root = 'C', intensity = 0.5 } = {}) => new MelodicDevelopmentComposer(name, root, intensity),
    advancedVoiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => new AdvancedVoiceLeadingComposer(name, root, commonToneWeight),
  };

  static create(config = {}) {
    const type = config.type || 'scale';
    const factory = this.constructors[type];
    if (!factory) {
      console.warn(`ComposerFactory.create: unknown composer type "${type}", defaulting to random scale composer.`);
      return this.constructors.scale({ name: 'random', root: 'random' });
    }
    return factory(config);
  }

  static createRandom(extraConfig = {}) {
    // Strictly sample from global COMPOSERS array (defined in src/sheet.js / sheet.md).
    // Do not fall back to arbitrary constructor types (e.g., 'measure').
    if (typeof COMPOSERS !== 'undefined' && Array.isArray(COMPOSERS) && COMPOSERS.length > 0) {
      const tries = Math.min(8, COMPOSERS.length);
      for (let i = 0; i < tries; i++) {
        const cfg = COMPOSERS[ri(COMPOSERS.length - 1)];
        try {
          const composer = this.create(Object.assign({}, cfg, extraConfig));
          // Prefer composers that can return notes
          if (composer && typeof composer.getNotes === 'function') {
            try {
              const notes = composer.getNotes();
              if (Array.isArray(notes) && notes.length > 0) return composer;
            } catch (e) {
              // getNotes failed; try another COMPOSERS entry
              continue;
            }
          } else if (composer) {
            // Composer doesn't implement getNotes but creation succeeded; accept it.
            return composer;
          }
        } catch (e) {
          // Creation from this COMPOSERS entry failed; try another entry
          continue;
        }
      }
      // If none of the COMPOSERS entries produced a valid composer, fall back to a safe random scale composer
      try { return this.create(Object.assign({}, { type: 'scale', name: 'random', root: 'random' }, extraConfig)); } catch (e) { /* final fallback below */ }
    }

    // Final fallback: create a random scale composer
    return this.create(Object.assign({}, extraConfig, { type: 'scale', name: 'random', root: 'random' }));
  }

}

