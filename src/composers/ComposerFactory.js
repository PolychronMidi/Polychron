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
      if (/** @type {any} */ (progression) === 'random') {
        const len = ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) p.push(allChords[ri(allChords.length - 1)]);
      }
      // Defensive: ensure externally supplied progression entries are normalized strings
      if (Array.isArray(p)) {
        try { p = p.map(normalizeChordSymbol); } catch (e) { console.warn('ComposerFactory.chords: failed to normalize chord symbols in progression, using as-is:', e && e.stack ? e.stack : e); }
      }
      return new (ChordComposer)(p);
    },
    mode: ({ name = 'ionian', root = 'C' } = {}) => {
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      if (name === 'random') {
        // If root is also random, pick a precomputed valid pair ("C ionian") and split it
        if (root === 'random') {
          const pair = allModes[ri(allModes.length - 1)];
          if (typeof pair === 'string' && pair.indexOf(' ') > -1) {
            const parts = pair.split(' ');
            const rootFromPair = parts[0];
            const modeName = parts.slice(1).join(' ');
            return new (ModeComposer)(modeName, rootFromPair);
          }
        }
        // Otherwise pick a random mode name and use the provided root
        const modeEntries = t.Mode.all();
        const modeEntry = modeEntries[ri(modeEntries.length - 1)];
        const modeName = (modeEntry && modeEntry.name) ? modeEntry.name : 'ionian';
        return new (ModeComposer)(modeName, r);
      }
      return new (ModeComposer)(name, r);
    },

    pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      return new (PentatonicComposer)(r, t);
    },
    tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) => new TensionReleaseComposer(key, quality, tensionCurve),
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => new ModalInterchangeComposer(key, primaryMode, borrowProbability),
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) => {
      const k = key === 'random' ? allNotes[ri(allNotes.length - 1)] : key;
      return new HarmonicRhythmComposer(progression, k, measuresPerChord, quality);
    },
    melodicDevelopment: ({ name = 'major', root = 'C', intensity = 0.5 } = {}) => new MelodicDevelopmentComposer(name, root, intensity),
    voiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => new VoiceLeadingComposer(name, root, commonToneWeight),
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
    // Strictly sample from global COMPOSERS array (defined in src/config.js / config.md).
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
              console.warn('ComposerFactory.createRandom: composer.getNotes() threw, trying another COMPOSERS entry:', e && e.stack ? e.stack : e);
              continue;
            }
          } else if (composer) {
            console.warn('ComposerFactory.createRandom: created composer without getNotes(), accepting it.', composer);
            return composer;
          }
        } catch (e) {
          console.warn('ComposerFactory.createRandom: failed to create composer from COMPOSERS entry, trying another:', e && e.stack ? e.stack : e);
          continue;
        }
      }
        try { return this.create(Object.assign({}, { type: 'scale', name: 'random', root: 'random' }, extraConfig)); } catch (e) { console.warn('No valid entry found in COMPOSERS array, falling back to random scale composer:', e && e.stack ? e.stack : e); }
    } else {
      console.warn('ComposerFactory.createRandom: COMPOSERS array is undefined or empty, defaulting to random scale composer.');
    }
    return this.create(Object.assign({}, extraConfig, { type: 'scale', name: 'random', root: 'random' }));
  }
}
