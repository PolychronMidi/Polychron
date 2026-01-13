require('./stage');

/**
 * POLYCHRON MAIN COMPOSITION LOOP
 *
 * CONTEXT SWITCHING PATTERN: Each layer has private timing state, but processing
 * uses shared global variables. LM.activate() switches contexts between layers.
 *
 * TIME INCREMENTATION HIERARCHY:
 * Section → accumulates Phrase durations → accumulates Measure durations
 * Phrase → fixed duration (tpMeasure * measuresPerPhrase)
 * Measure → fixed duration (tpMeasure) → Beat → Division → Subdivision → Subsubdivision
 *
 * WHY: Enables polyrhythmic layers with different phrase tick lengths(tpSec) while maintaining
 * absolute time synchronization at phrase boundaries.
 */

// Initialize layer manager with private state per layer
const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, setTuningAndInstruments);
const { state: poly, buffer: c2 } = LM.register('poly', 'c2', {}, setTuningAndInstruments);

totalSections = ri(SECTIONS.min, SECTIONS.max);

for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    // Select shared composer for both layers in this phrase
    composer = ra(composers);
    [numerator, denominator] = composer.getMeter();
    getMidiMeter();
    getPolyrhythm(); // sets measuresPerPhrase for both layers

    LM.activate('primary', false);

    setUnitTiming('phrase');

    // PRIMARY METER LOOP
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      setUnitTiming('measure');

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        trackBeatRhythm();
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
          trackDivRhythm();
          setUnitTiming('division');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            playNotes();
          }

          for (subsubdivIndex = 0; subsubdivIndex < subdivsPerSub; subsubdivIndex++) {
            setUnitTiming('subsubdivision');
            playNotes2();
          }
        }
      }
    }

    LM.advance('primary', 'phrase');

    // POLY METER SETUP (activate poly buffer and timing)
    LM.activate('poly', true);

    getMidiMeter(); // Calculate poly's meter

    setUnitTiming('phrase');

    // POLY METER LOOP
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      setUnitTiming('measure');

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        trackBeatRhythm();
        setUnitTiming('beat');
        setOtherInstruments();
        setBinaural();
        setBalanceAndFX();
        playDrums2();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);

        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          trackDivRhythm();
          setUnitTiming('division');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            playNotes();
          }

          for (subsubdivIndex = 0; subsubdivIndex < subdivsPerSub; subsubdivIndex++) {
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
