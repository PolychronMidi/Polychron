require('./stage');
/**
 * POLYCHRON MAIN COMPOSITION LOOP
 *
 * Philosophy: Dual-layer processing with shared absolute timing
 * 1. Primary layer: Full timing calculation
 * 2. Poly layer: Independent timing recalculation
 * 3. Both layers: Align at phrase boundaries (absolute time)
 * 4. Future: Infinite layers following same pattern
 *
 * The loop structure is intentionally duplicated to maintain
 * explicit control over each layer's processing. When adding
 * more layers, duplicate this pattern rather than abstracting
 * prematurely - explicit is better than clever.
 */

// Initialize layer manager and create per-layer buffers via register
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

    LM.activate('primary', null, false);

    measuresPerPhrase = measuresPerPhrase1;
    setPhraseTiming('primary');

    logUnit('phrase');

    // PRIMARY METER LOOP
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      setMeasureTiming('primary');
      logUnit('measure');
      beatRhythm = setRhythm('beat');

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        trackBeatRhythm();
        beatCount++;
        setBeatTiming();
        logUnit('beat');
        divRhythm = setRhythm('div');
        setOtherInstruments();
        setBinaural();
        setBalanceAndFX();
        playDrums();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);

        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          trackDivRhythm();
          setDivTiming();
          logUnit('division');
          subdivRhythm = setRhythm('subdiv');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setSubdivTiming();
            logUnit('subdivision');
            playNotes();
          }

          for (subsubdivIndex = 0; subsubdivIndex < subdivsPerSub; subsubdivIndex++) {
            setSubsubdivTiming();
            logUnit('subsubdivision');
            playNotes2();
          }
        }
      }
    }

    nextPhrase('primary');

    // Set poly meter for getMidiMeter()
    numerator = polyNumerator;
    denominator = polyDenominator;

    getMidiMeter(); // Calculate poly's meter

    // POLY METER SETUP (activate poly buffer and timing)
    LM.activate('poly', null, true);

    measuresPerPhrase = measuresPerPhrase2;
    setPhraseTiming('poly');

    logUnit('phrase');

    // POLY METER LOOP
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      setMeasureTiming('poly');
      logUnit('measure');
      beatRhythm = setRhythm('beat');

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        trackBeatRhythm();
        setBeatTiming();
        logUnit('beat');
        divRhythm = setRhythm('div');
        setOtherInstruments();
        setBinaural();
        setBalanceAndFX();
        playDrums2();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);

        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          trackDivRhythm();
          setDivTiming();
          logUnit('division');
          subdivRhythm = setRhythm('subdiv');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setSubdivTiming();
            logUnit('subdivision');
            playNotes();
          }

          for (subsubdivIndex = 0; subsubdivIndex < subdivsPerSub; subsubdivIndex++) {
            setSubsubdivTiming();
            logUnit('subsubdivision');
            playNotes2();
          }
        }
      }
    }

    nextPhrase('poly');

  }

  nextSection('primary');
  logUnit('section');

  nextSection('poly');
  logUnit('section');

}

grandFinale();
