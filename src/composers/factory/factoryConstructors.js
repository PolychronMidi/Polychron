factoryConstructors = {
  build(factoryManager) {
    if (!factoryManager || typeof factoryManager !== 'function') {
      throw new Error('factoryConstructors.build: factoryManager class is required');
    }

    return {
      measure: () => new MeasureComposer(),

      scale: ({ name = 'major', root = 'C' } = {}) => {
        if (!Array.isArray(allScales) || allScales.length === 0) throw new Error('ComposerFactory.scale: allScales not available');
        if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.scale: allNotes not available');
        const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
        const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
        return new ScaleComposer(n, r);
      },

      chords: ({ progression = ['C'], direction = 'R' } = {}) => {
        let p = progression;
        if (/** @type {any} */ (progression) === 'random') {
          if (!Array.isArray(allChords) || allChords.length === 0) throw new Error('ComposerFactory.chords: allChords not available');
          const len = ri(2, 5);
          p = [];
          for (let i = 0; i < len; i++) p.push(allChords[ri(allChords.length - 1)]);
        }
        if (Array.isArray(p)) {
          p = p.map(normalizeChordSymbol);
        }
        if (typeof direction !== 'string' || direction.length === 0) throw new Error('ComposerFactory.chords: direction must be a non-empty string');
        const composer = new ChordComposer(p);
        if (direction.toUpperCase() !== 'R') {
          composer.noteSet(p, direction);
        }
        return composer;
      },

      mode: ({ name = 'ionian', root = 'C' } = {}) => {
        if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.mode: allNotes not available');
        const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
        if (name === 'random') {
          if (root === 'random') {
            if (!Array.isArray(allModes) || allModes.length === 0) throw new Error('ComposerFactory.mode: allModes not available');
            const pair = allModes[ri(allModes.length - 1)];
            if (typeof pair === 'string' && pair.indexOf(' ') > -1) {
              const parts = pair.split(' ');
              const rootFromPair = parts[0];
              const modeName = parts.slice(1).join(' ');
              return new ModeComposer(modeName, rootFromPair);
            }
          }
          const modeEntries = t.Mode.all();
          const modeEntry = modeEntries[ri(modeEntries.length - 1)];
          const modeName = (modeEntry && modeEntry.name) ? modeEntry.name : 'ionian';
          return new ModeComposer(modeName, r);
        }
        return new ModeComposer(name, r);
      },

      pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
        if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.pentatonic: allNotes not available');
        const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
        const type = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
        return new PentatonicComposer(r, type);
      },

      tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5, enablePhraseArcs = true, phraseArcOpts = {}, phraseTensionScaling = true } = {}) => {
        if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.tensionRelease: allNotes not available');
        const k = factoryManager.resolveProgressionKeyOrFail(key, 'ComposerFactory.tensionRelease', quality);
        const phraseArcManager = enablePhraseArcs ? factoryManager.getPhraseArcManager(phraseArcOpts) : null;
        return new TensionReleaseComposer(k, quality, tensionCurve, { phraseArcManager, phraseTensionScaling });
      },

      modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => {
        if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.modalInterchange: allNotes not available');
        const k = factoryManager.resolveProgressionKeyOrFail(key, 'ComposerFactory.modalInterchange', primaryMode);
        return new ModalInterchangeComposer(k, primaryMode, borrowProbability);
      },

      harmonicRhythm: ({ progression = ['I', 'IV', 'V', 'I'], key = 'C', measuresPerChord = 2, quality = 'major', changeEmphasis = 2.0, anticipation = false, settling = true, enablePhraseArcs = true, phraseArcOpts = {}, phraseBoundaryEmphasis = 1.3 } = {}) => {
        if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.harmonicRhythm: allNotes not available');
        const k = factoryManager.resolveProgressionKeyOrFail(key, 'ComposerFactory.harmonicRhythm', quality);
        const phraseArcManager = enablePhraseArcs ? factoryManager.getPhraseArcManager(phraseArcOpts) : null;
        return new HarmonicRhythmComposer(progression, k, measuresPerChord, quality, { changeEmphasis, anticipation, settling, phraseArcManager, phraseBoundaryEmphasis });
      },

      melodicDevelopment: ({ name = 'major', root = 'C', intensity = 0.5, developmentBias = 0.7, enablePhraseArcs = true, phraseArcOpts = {}, inversionMode = 'diatonic', inversionPivotMode = 'first-note', inversionFixedDegree = 0, normalizeToScale = true, useDegreeNoise = true, arcScaling = true } = {}) => {
        const phraseArcManager = enablePhraseArcs ? factoryManager.getPhraseArcManager(phraseArcOpts) : null;
        return new MelodicDevelopmentComposer(name, root, intensity, developmentBias, { phraseArcManager, inversionMode, inversionPivotMode, inversionFixedDegree, normalizeToScale, useDegreeNoise, arcScaling });
      },

      voiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7, contraryMotionPreference = 0.4 } = {}) => {
        return new VoiceLeadingComposer(name, root, commonToneWeight, contraryMotionPreference);
      },
    };
  }
};
