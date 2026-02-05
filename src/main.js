// main.js - Main composition engine orchestrating section, phrase, measure hierarchy.
require('./index');

main = async function main() { console.log('Starting main.js ...');

const { layer: L1, buffer: c1 } = LM.register('L1', 'c1', {}, () => setTuningAndInstruments());
const { layer: L2, buffer: c2 } = LM.register('L2', 'c2', {}, () => setTuningAndInstruments());

totalSections = ri(SECTIONS.min, SECTIONS.max);
for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  // Initialize each layer's section origin so layer-relative ticks are correct and explicit
  LM.setSectionStartAll();

  // Explicitly log a `section` marker for both layers so Section 1 is present
  // for both `L1` and `L2` outputs. Restore `L1` as active for
  // the phrase loop immediately after logging.
  LM.activate('L1', false);
  setUnitTiming('section');
  // Activate L2 without setting `isPoly` yet (L2 meter isn't known until later)
  LM.activate('L2', false);
  setUnitTiming('section');
  LM.activate('L1', false);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    composer = ComposerFactory.createRandom({ root: 'random' });
    [numerator, denominator] = composer.getMeter();
    // Activate L1 layer first so activation doesn't overwrite freshly computed timing
    LM.activate('L1', false);
    getMidiTiming();
    getPolyrhythm();
    measuresPerPhrase = measuresPerPhrase1;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      setUnitTiming('measure');
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
        playNotesForUnit('beat', { playProb: .2, stutterProb: .2 });
        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('div');
          playNotesForUnit('div', { playProb: .2, stutterProb: .2 });
          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            playNotesForUnit('subdiv', { playProb: .2, stutterProb: .2 });
            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              if (subsubdivIndex > 0) { playNotesForUnit('subsubdiv', { playProb: .2, stutterProb: .2 }); }
            }
          }
        }
      }
    }

    LM.advance('L1', 'phrase');

    LM.activate('L2', true);

    getMidiTiming();
    measuresPerPhrase = measuresPerPhrase2;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      setUnitTiming('measure');
      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        setUnitTiming('beat');
        setOtherInstruments();
        setBinaural();
        setBalanceAndFX();
        playDrums2();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        playNotesForUnit('beat', { playProb: .2, stutterProb: .2 });

        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {

          setUnitTiming('div');
          playNotesForUnit('div', { playProb: .2, stutterProb: .2 });

          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            playNotesForUnit('subdiv', { playProb: .2, stutterProb: .2 });

            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              if (subsubdivIndex > 0) { playNotesForUnit('subsubdiv', { playProb: .2, stutterProb: .2 }); }
            }
          }
        }
      }
    }

    LM.advance('L2', 'phrase');
  }

  LM.advance('L1', 'section');

  LM.advance('L2', 'section');

}

  grandFinale();
}

// Run main only when invoked as the entry script
if (require.main === module) {
  main().catch((err) => {
    console.error('main.js failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
