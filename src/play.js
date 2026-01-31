// play.js - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md
require('./stage'); // This file imports EVERY other file & dependency in the project - Global scope used by design: DO NOT spam up files with useless import / export statements
(async function main() { console.log('Starting play.js ...');

const { layer: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => setTuningAndInstruments());
const { layer: poly, buffer: c2 } = LM.register('poly', 'c2', {}, () => setTuningAndInstruments());

totalSections = ri(SECTIONS.min, SECTIONS.max);
for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);
  setUnitTiming('section');

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    composer = ComposerFactory.createRandom({ root: 'random' });
    [numerator, denominator] = composer.getMeter();
    getMidiTiming();
    getPolyrhythm();
    LM.activate('primary', false);
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
        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('division');
          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            playNotes();
            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              playNotes2();
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
            playNotes();

            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              playNotes2();
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
