// play.js - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md

require('./stage');

const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, setTuningAndInstruments);
const { state: poly, buffer: c2 } = LM.register('poly', 'c2', {}, setTuningAndInstruments);

totalSections = ri(SECTIONS.min, SECTIONS.max);

for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    composer = ra(composers);
    [numerator, denominator] = composer.getMeter();
    getMidiMeter();
    getPolyrhythm();

    LM.activate('primary', false);
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

        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('division');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            playNotes();
          }

          for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
            setUnitTiming('subsubdivision');
            playNotes2();
          }
        }
      }
    }

    LM.advance('primary', 'phrase');

    LM.activate('poly', true);
    getMidiMeter();
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

        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('division');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            playNotes();
          }

          for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
            setUnitTiming('subsubdivision');
            playNotes2();
          }
        }
      }
    }

    LM.advance('poly', 'phrase');

  }

  LM.advance('primary', 'section');
  logUnit('section');

  LM.advance('poly', 'section');
  logUnit('section');

}

grandFinale();
