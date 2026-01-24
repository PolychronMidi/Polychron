// play.js - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md

require('./stage');
require('./structure');

const BASE_BPM=BPM;

// Initialize composers from configuration if not already done
if (!composers || composers.length === 0) {
  composers = COMPOSERS.map((config) => ComposerFactory.create(config));
}

const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => stage.setTuningAndInstruments());
const { state: poly, buffer: c2 } = LM.register('poly', 'c2', {}, () => stage.setTuningAndInstruments());

totalSections = ri(SECTIONS.min, SECTIONS.max);
// Honor optional environment limit for quick test runs (temporary; safe to remove)
if (process.env.PLAY_LIMIT) {
  const lim = Number(process.env.PLAY_LIMIT);
  if (Number.isFinite(lim) && lim > 0) totalSections = Math.min(totalSections, lim);
}

for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  const sectionProfile=resolveSectionProfile();
  phrasesPerSection=sectionProfile.phrasesPerSection;
  currentSectionType=sectionProfile.type;
  currentSectionDynamics=sectionProfile.dynamics;
  BPM=m.max(1,m.round(BASE_BPM * sectionProfile.bpmScale));
  activeMotif=sectionProfile.motif ? new Motif(sectionProfile.motif.map(offset=>({ note: clampMotifNote(60+offset) }))) : null;

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    if (globalThis.__POLYCHRON_TEST__?.enableLogging) console.log(`PLAY: section=${sectionIndex} phrase=${phraseIndex}`);
    composer = ra(composers);
    [numerator, denominator] = composer.getMeter();
    getMidiTiming();
    getPolyrhythm();

    LM.activate('primary', false);
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      if (globalThis.__POLYCHRON_TEST__?.enableLogging) console.log(`PLAY: section=${sectionIndex} phrase=${phraseIndex} measure=${measureIndex}`);
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

        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('division');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            stage.playNotes();
          }

          for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
            setUnitTiming('subsubdivision');
            stage.playNotes2();
          }
        }
      }
    }

    LM.advance('primary', 'phrase');

    LM.activate('poly', true);
    getMidiTiming();
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

        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('division');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            stage.playNotes();
          }

          for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
            setUnitTiming('subsubdivision');
            stage.playNotes2();
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

  BPM=BASE_BPM;
  activeMotif=null;
}

grandFinale();
