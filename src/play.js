// play.js - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md
require('./stage');
const fs = require('fs');
const path = require('path');

(async function main() {

    const { ComposerFactory } = require('./composers');

    console.log('Starting play.js ...');


const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => stage.setTuningAndInstruments());
const { state: poly, buffer: c2 } = LM.register('poly', 'c2', {}, () => stage.setTuningAndInstruments());

totalSections = ri(SECTIONS.min, SECTIONS.max);
for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    composer = ComposerFactory.createRandom({ root: 'random' });
    [numerator, denominator] = composer.getMeter();
    setMidiTiming();
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
        stage.setOtherInstruments();
        stage.setBinaural();
        stage.setBalanceAndFX();
        playDrums();
        stage.stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stage.stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stage.stutterPan(flipBin ? flipBinT3 : flipBinF3) : stage.stutterPan(stutterPanCHs);
        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('division');
          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            stage.playNotes();
            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              stage.playNotes2();
            }
          }
        }
      }
    }

    LM.advance('primary', 'phrase');

    LM.activate('poly', true);

    setMidiTiming();
    measuresPerPhrase = measuresPerPhrase2;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      setUnitTiming('measure');

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        setUnitTiming('beat');
        stage.setOtherInstruments();
        stage.setBinaural();
        stage.setBalanceAndFX();
        playDrums2();
        stage.stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stage.stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stage.stutterPan(flipBin ? flipBinT3 : flipBinF3) : stage.stutterPan(stutterPanCHs);

        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {

          setUnitTiming('division');

          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');

            stage.playNotes();

            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              stage.playNotes2();
            }

          }

        }

      }
    }

    LM.advance('poly', 'phrase');
  }

  LM.advance('primary', 'section');

  LM.advance('poly', 'section');

  activeMotif=null;
}

grandFinale();
})().catch((err) => {
  console.error('play.js failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
