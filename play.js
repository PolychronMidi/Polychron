require('./stage');

// Dual CSV buffers for polyrhythm separation
c1 = []; // Primary meter composition
c2 = []; // Poly meter composition
c = c2;
setTuningAndInstruments();
c = c1;  // Active buffer pointer
setTuningAndInstruments();

// Reset timing state (primary and poly declared in backstage.js)
primary.phraseStart = 0; primary.phraseStartTime = 0; primary.sectionStart = 0; primary.sectionStartTime = 0;
poly.phraseStart = 0; poly.phraseStartTime = 0; poly.sectionStart = 0; poly.sectionStartTime = 0;

totalSections = ri(SECTIONS.min, SECTIONS.max);
for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    composer = ra(composers);
    [numerator, denominator] = composer.getMeter();

    // PRIMARY METER SETUP
    c = c1;
    phraseStart = primary.phraseStart;
    phraseStartTime = primary.phraseStartTime;
    sectionStart = primary.sectionStart;
    sectionStartTime = primary.sectionStartTime;

    getMidiMeter();
    getPolyrhythm();

    measuresPerPhrase = measuresPerPhrase1;
    tpPhrase = tpMeasure * measuresPerPhrase1;
    spPhrase = tpPhrase / tpSec;

    logUnit('phrase');

    // PRIMARY METER LOOP
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      composer = ra(composers);
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

    // Advance primary context
    primary.phraseStart = phraseStart + tpPhrase;
    primary.phraseStartTime = phraseStartTime + spPhrase;
    // Update section's accumulated time with this phrase
    primary.sectionStartTime = sectionStartTime + spPhrase;
    // Update sectionEnd (the actual tick position where this section ends)
    // Accumulate across phrases: sectionEnd = previous sectionEnd + this phrase's ticks
    if (primary.sectionEnd === undefined) primary.sectionEnd = sectionStart;
    primary.sectionEnd += tpPhrase;
    // Capture accumulated section timing BEFORE switching to poly (which recalculates tpSection/spSection)
    primary.tpSection = tpSection;
    primary.spSection = spSection;
    // Also save final tpSec at end of primary phrase (for grandFinale)
    primary.tpSec = tpSec;

    // POLY METER SETUP
    beatRhythm = divRhythm = subdivRhythm = 0;
    c = c2;
    phraseStart = poly.phraseStart;
    phraseStartTime = poly.phraseStartTime;
    sectionStart = poly.sectionStart;
    sectionStartTime = poly.sectionStartTime;

    numerator = polyNumerator;
    denominator = polyDenominator;
    meterRatio = polyMeterRatio;
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

    // Advance poly context
    poly.phraseStart = phraseStart + tpPhrase;
    poly.phraseStartTime = phraseStartTime + spPhrase;
    // Update section's accumulated time with this phrase
    poly.sectionStartTime = sectionStartTime + spPhrase;
    // Update sectionEnd for poly meter
    if (poly.sectionEnd === undefined) poly.sectionEnd = sectionStart;
    poly.sectionEnd += tpPhrase;
    // Store poly's section timing (now in global tpSection/spSection after poly loop)
    poly.tpSection = tpSection;
    poly.spSection = spSection;
    // Also save final tpSec at end of poly phrase (for grandFinale)
    poly.tpSec = tpSec;

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

  // Advance sections for both contexts - use context-specific section timing
  // Each context has accumulated its tpSection/spSection during phrases
  c = c1;
  sectionStart = primary.sectionStart;
  tpSection = primary.tpSection;
  spSection = primary.spSection;
  phraseStart = primary.phraseStart;
  phraseStartTime = primary.phraseStartTime;
  // Use accumulated sectionStartTime for logging
  sectionStartTime = primary.sectionStartTime;
  logUnit('section');
  // Update sectionStart to where the section actually ends (phraseStart + tpPhrase)
  // Note: phraseStart is start of next section, so section end = phraseStart - tpSection
  primary.sectionStart = primary.phraseStart - tpSection;
  // Reset for next section (will be accumulated from phrases again)
  primary.sectionStartTime = 0;

  c = c2;
  sectionStart = poly.sectionStart;
  tpSection = poly.tpSection;
  spSection = poly.spSection;
  phraseStart = poly.phraseStart;
  phraseStartTime = poly.phraseStartTime;
  // Use accumulated sectionStartTime for logging
  sectionStartTime = poly.sectionStartTime;
  logUnit('section');
  // Update sectionStart to where the section actually ends
  poly.sectionStart = poly.phraseStart - tpSection;
  // Reset for next section (will be accumulated from phrases again)
  poly.sectionStartTime = 0;

  // Reset global section timing for next iteration
  tpSection = spSection = 0;
}

grandFinale();
