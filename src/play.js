// play.js - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md

require('./stage');
require('./structure');
const { writeIndexTrace, isEnabled, writeDebugFile } = require('./logGate');

console.log('Starting play.js ...');

const BASE_BPM=BPM;

// Allow environment gating to enable verbose internal logging for repro/test runs
if (process.env.__POLYCHRON_TEST_ENABLE_LOGGING) {
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  globalThis.__POLYCHRON_TEST__.enableLogging = true;
}

// Initialize composers from configuration if not already done
if (!composers || composers.length === 0) {
  composers = COMPOSERS.map((config) => ComposerFactory.create(config));
}

// Validate composers immediately and fail fast if any required getter is missing
(function validateComposers() {
  try {
    const fs = require('fs'); const path = require('path');
    const out = path.join(process.cwd(), 'output', 'composer-validation.ndjson');
    for (let i = 0; i < composers.length; i++) {
      const c = composers[i];
      const missing = [];
      if (!c || typeof c.getDivisions !== 'function') missing.push('getDivisions');
      if (!c || typeof c.getSubdivisions !== 'function') missing.push('getSubdivisions');
      if (!c || typeof c.getSubsubdivs !== 'function') missing.push('getSubsubdivs');
      if (!c || typeof c.getMeter !== 'function') missing.push('getMeter');
      if (missing.length) {
        const payload = { when: new Date().toISOString(), index: i, missing, config: COMPOSERS[i] };
        try { writeDebugFile('composer-validation.ndjson', payload); } catch (e) {}
        throw new Error(`Composer[${i}] missing required getters: ${missing.join(', ')}`);
      }
    }
  } catch (e) { console.error('Composer validation failed:', e && e.stack ? e.stack : e); throw e; }
})();

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
    // In PLAY_LIMIT mode, bound phrase loops to keep runtime reasonable for tests
    if (process.env.PLAY_LIMIT) phrasesPerSection = Math.min(phrasesPerSection, Number(process.env.PLAY_LIMIT) || 1);

    if (globalThis.__POLYCHRON_TEST__?.enableLogging) console.log(`PLAY: section=${sectionIndex} phrase=${phraseIndex}`);
    composer = ra(composers);
    // Defensive check: ensure selected composer has required getters; fail fast with diagnostics if not
    if (!composer || typeof composer.getDivisions !== 'function' || typeof composer.getSubdivisions !== 'function' || typeof composer.getSubsubdivs !== 'function' || typeof composer.getMeter !== 'function') {
      try {
        const payload = { when: new Date().toISOString(), phase: 'select-composer', composerType: (composer && composer.constructor && composer.constructor.name) ? composer.constructor.name : typeof composer, hasGetDivisions: composer && typeof composer.getDivisions === 'function', hasGetSubdivisions: composer && typeof composer.getSubdivisions === 'function', hasGetSubsubdivs: composer && typeof composer.getSubsubdivs === 'function', hasGetMeter: composer && typeof composer.getMeter === 'function', composersSnapshot: (Array.isArray(composers) ? composers.map(c => (c && c.constructor && c.constructor.name) ? c.constructor.name : (typeof c)) : null), stack: (new Error()).stack };
        try { writeDebugFile('composer-selection-errors.ndjson', payload); } catch (e) {}
      } catch (e) {}
      throw new Error('composer selection invalid: missing getters');
    }
    [numerator, denominator] = composer.getMeter();
    getMidiTiming();
    getPolyrhythm();

    LM.activate('primary', false);
    setUnitTiming('phrase');
    // Respect PLAY_LIMIT to bound measures per phrase in quick runs
    if (process.env.PLAY_LIMIT) measuresPerPhrase = Math.min(measuresPerPhrase, Number(process.env.PLAY_LIMIT) || 1);
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
          // Trace pre-division state (temporary debug)
          try {
            const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
            const cache = (LM.layers[layer] && LM.layers[layer].state) ? LM.layers[layer].state._composerCache : null;
            const _beatKey = `beat:${measureIndex}:${beatIndex}`;
            const _divKey = `div:${measureIndex}:${beatIndex}:${divIndex}`;
            const trace = {
              when: new Date().toISOString(), layer: 'primary', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, divsPerBeat, subdivsPerDiv,
              // Avoid calling composer getters here to prevent flip/flop between calls; instead peek at any existing cache entries
              composerDivisions: cache && cache[_beatKey] ? cache[_beatKey].divisions : null,
              composerSubdivisions: cache && cache[_divKey] ? cache[_divKey].subdivisions : null,
              composerCachePeek: cache ? { beat: !!(cache && cache[_beatKey]), div: !!(cache && cache[_divKey]) } : null
            };
            writeIndexTrace(trace); } catch (_e) {}

          setUnitTiming('division');

          // Snapshot subdivision/subsubdivision counts to avoid flip-flop during iteration
          let localSubdivsPerDiv = Math.max(1, Number.isFinite(Number(subdivsPerDiv)) ? Number(subdivsPerDiv) : 1);
          // When running in PLAY_LIMIT mode (tests/quick-runs), cap inner loop counts to keep runtime bounded
          if (process.env.PLAY_LIMIT) localSubdivsPerDiv = Math.min(localSubdivsPerDiv, 3);
          for (subdivIndex = 0; subdivIndex < localSubdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            stage.playNotes();

            // Subsubdivisions are children of subdivisions; iterate inside subdivision loop
            let localSubsubsPerSub = Math.max(1, (typeof subsubsPerSub !== 'undefined' && Number.isFinite(Number(subsubsPerSub))) ? Number(subsubsPerSub) : 1);
            if (process.env.PLAY_LIMIT) localSubsubsPerSub = Math.min(localSubsubsPerSub, 2);
            for (subsubdivIndex = 0; subsubdivIndex < localSubsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdivision');
              stage.playNotes2();
              if (subsubdivIndex + 1 === localSubsubsPerSub) resetIndexWithChildren('subsubdivision');
            }

            if (subdivIndex + 1 === localSubdivsPerDiv) resetIndexWithChildren('subdivision');
          }

          // Trace post-subdivision summary (temporary debug)
          try {
            const after = { when: new Date().toISOString(), layer: 'primary', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, divsPerBeat, subdivsPerDiv };
            writeIndexTrace(after);
          } catch (_e) {}
        }
        // Reset division children when this was the last division in the beat
        if (divIndex + 1 === divsPerBeat) resetIndexWithChildren('division');
        // Reset beat children when this was the last beat in the measure
        if (beatIndex + 1 === numerator) resetIndexWithChildren('beat');
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
          // Trace pre-division state (temporary debug)
          try {
            const trace = {
              when: new Date().toISOString(), layer: 'poly', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, divsPerBeat, subdivsPerDiv,
              // Avoid calling composer getters here to prevent flip/flop between calls; use clamped values from time.js instead
              composerDivisions: null,
              composerSubdivisions: null
            };
            writeIndexTrace(trace); } catch (_e) {}

          setUnitTiming('division');

          // Snapshot subdivision/subsubdivision counts to avoid flip-flop during iteration
          let localSubdivsPerDiv = Math.max(1, Number.isFinite(Number(subdivsPerDiv)) ? Number(subdivsPerDiv) : 1);
          // When running in PLAY_LIMIT mode (tests/quick-runs), cap inner loop counts to keep runtime bounded
          if (process.env.PLAY_LIMIT) localSubdivsPerDiv = Math.min(localSubdivsPerDiv, 3);
          for (subdivIndex = 0; subdivIndex < localSubdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            stage.playNotes();

            // Subsubdivisions belong to a subdivision; iterate here
            let localSubsubsPerSub = Math.max(1, (typeof subsubsPerSub !== 'undefined' && Number.isFinite(Number(subsubsPerSub))) ? Number(subsubsPerSub) : 1);
            if (process.env.PLAY_LIMIT) localSubsubsPerSub = Math.min(localSubsubsPerSub, 2);
            for (subsubdivIndex = 0; subsubdivIndex < localSubsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdivision');
              stage.playNotes2();
              if (subsubdivIndex + 1 === localSubsubsPerSub) resetIndexWithChildren('subsubdivision');
            }

            if (subdivIndex + 1 === localSubdivsPerDiv) resetIndexWithChildren('subdivision');
          }

          // Trace post-subdivision summary (temporary debug)
          try {
            const after = { when: new Date().toISOString(), layer: 'poly', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, divsPerBeat, subdivsPerDiv };
            writeIndexTrace(after);
          } catch (_e) {}
        }
        if (divIndex + 1 === divsPerBeat) resetIndexWithChildren('division');
        if (beatIndex + 1 === numerator) resetIndexWithChildren('beat');
      }
      if (measureIndex + 1 === measuresPerPhrase) resetIndexWithChildren('measure');
    }

    LM.advance('poly', 'phrase');
    if (phraseIndex + 1 === phrasesPerSection) resetIndexWithChildren('phrase');
  }

  LM.advance('primary', 'section');

  LM.advance('poly', 'section');

  BPM=BASE_BPM;
  activeMotif=null;
}

grandFinale();
