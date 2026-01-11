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

    // PRIMARY METER SETUP (use registry.activate to set active buffer and timing)
    LM.activate('primary', null, false);

    getMidiMeter();
    getPolyrhythm();

    measuresPerPhrase = measuresPerPhrase1;
    tpPhrase = tpMeasure * measuresPerPhrase1;
    spPhrase = tpPhrase / tpSec;

    logUnit('phrase');

    // PRIMARY METER LOOP
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      setMeasureTiming();
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

    // Store primary phrase end
    const primaryPhraseEnd = phraseStartTime + spPhrase;

    // Advance primary layer
    LM.advance('primary');

    // POLY METER SETUP (activate poly buffer and timing)
    LM.activate('poly', null, true);

    getMidiMeter(); // Recalculates with poly's syncFactor

    measuresPerPhrase = measuresPerPhrase2;
    tpPhrase = tpMeasure * measuresPerPhrase2;
    spPhrase = tpPhrase / tpSec;

    logUnit('phrase');

    // POLY METER LOOP
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      setMeasureTiming();
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

    // Store poly phrase end
    const polyPhraseEnd = phraseStartTime + spPhrase;

    // Advance poly layer
    LM.advance('poly');

    // VERIFY PHRASE ALIGNMENT
    const timeDiff = Math.abs(primaryPhraseEnd - polyPhraseEnd);
    if (timeDiff > 0.001) {
      console.warn(`Phrase ${phraseIndex}: Sync drift ${timeDiff.toFixed(6)}s - Primary: ${formatTime(primaryPhraseEnd)} Poly: ${formatTime(polyPhraseEnd)}`);
    } else {
      console.log(`Phrase ${phraseIndex}: ✓ Synced - Both end at ${formatTime(primaryPhraseEnd)}`);
    }
  }

  // Update finalSectionTime to reflect accumulated phrase durations
  // This is the END of the section (used by grandFinale for track length)
  // Must save BEFORE resetting sectionStartTime for next section
  primary.finalSectionTime = primary.phraseStartTime;
  poly.finalSectionTime = poly.phraseStartTime;

  console.log(`SECTION ${sectionIndex + 1} COMPLETE:`);
  console.log(`  primary.phraseStartTime: ${primary.phraseStartTime.toFixed(4)}s`);
  console.log(`  poly.phraseStartTime: ${poly.phraseStartTime.toFixed(4)}s`);
  console.log(`  Difference: ${Math.abs(primary.phraseStartTime - poly.phraseStartTime).toFixed(6)}s`);

  // Advance sections for both layers - use layer-specific section timing
  // Each layer has accumulated its tpSection/spSection during phrases
  // activate primary buffer for section processing
  LM.activate('primary');
  // Variables already set by activate method
  logUnit('section');
  // Update sectionStart to where the section actually ends (phraseStart + tpPhrase)
  // Note: here phraseStart is start of next section, so section end = phraseStart - tpSection
  primary.sectionStart = primary.phraseStart - tpSection;
  // Reset for next section (will be accumulated from phrases again)
  primary.sectionStartTime = 0;

  // activate poly buffer for section processing
  LM.activate('poly');
  // Variables already set by activate method
  logUnit('section');
  // Update sectionStart to where the section actually ends
  poly.sectionStart = poly.phraseStart - tpSection;
  // Reset for next section (will be accumulated from phrases again)
  poly.sectionStartTime = 0;

  // Reset global section timing for next iteration
  tpSection = spSection = 0;
}

grandFinale();
