// play.js - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md
require('./stage'); // This file imports EVERY other file & dependency in the project - Global scope used by design: DO NOT spam up files with useless import / export statements
(async function main() { console.log('Starting play.js ...');

const { layer: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => setTuningAndInstruments());
const { layer: poly, buffer: c2 } = LM.register('poly', 'c2', {}, () => setTuningAndInstruments());

totalSections = ri(SECTIONS.min, SECTIONS.max);
for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  // Initialize each layer's section origin so relative ticks are correct and explicit
  LM.setSectionStartAll();

  // Explicitly log a `section` marker for both layers so Section 1 is present
  // for both `primary` and `poly` outputs. Restore `primary` as active for
  // the phrase loop immediately after logging.
  LM.activate('primary', false);
  setUnitTiming('section');
  // Activate poly without setting `isPoly` yet (poly meter isn't known until later)
  LM.activate('poly', false);
  setUnitTiming('section');
  LM.activate('primary', false);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    composer = ComposerFactory.createRandom({ root: 'random' });
    [numerator, denominator] = composer.getMeter();
    // Activate primary layer first so activation doesn't overwrite freshly computed timing
    LM.activate('primary', false);
    getMidiTiming();
    getPolyrhythm();
    measuresPerPhrase = measuresPerPhrase1;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      setUnitTiming('measure');
      // plan motif groups across this measure
      try {
        const layer = LM.layers[LM.activeLayer];
        MotifSpreader.spreadMeasure({ layer, measureStart, measureBeats: numerator, composer });
      } catch (_e) { /* swallow */ }
      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        beatCount++;
        setUnitTiming('beat');
        setOtherInstruments();
        setBinaural();
        setBalanceAndFX();
        playDrums();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('division');
          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            playSubdivNotes();
            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              playSubsubdivNotes();
            }
          }
        }
      }
    }

    LM.advance('primary', 'phrase');

    LM.activate('poly', true);

    getMidiTiming();
    measuresPerPhrase = measuresPerPhrase2;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      setUnitTiming('measure');
      // plan motif groups across this measure
      try {
        const layer = LM.layers[LM.activeLayer];
        MotifSpreader.spreadMeasure({ layer, measureStart, measureBeats: numerator, composer });
      } catch (_e) { /* swallow */ }
      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        setUnitTiming('beat');
        setOtherInstruments();
        setBinaural();
        setBalanceAndFX();
        playDrums2();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);

        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {

          setUnitTiming('division');

          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            playSubdivNotes();

            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              playSubsubdivNotes();
            }
          }
        }
      }
    }

    LM.advance('poly', 'phrase');
  }

  LM.advance('primary', 'section');

  LM.advance('poly', 'section');

}

grandFinale();
})().catch((err) => {
  console.error('play.js failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
