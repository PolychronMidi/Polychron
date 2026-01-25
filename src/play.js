// play.js - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md

require('./stage');
require('./structure');

const BASE_BPM=BPM;

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
        try { fs.appendFileSync(out, JSON.stringify(payload) + '\n'); } catch (e) {}
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
    if (globalThis.__POLYCHRON_TEST__?.enableLogging) console.log(`PLAY: section=${sectionIndex} phrase=${phraseIndex}`);
    composer = ra(composers);
    // Defensive check: ensure selected composer has required getters; fail fast with diagnostics if not
    if (!composer || typeof composer.getDivisions !== 'function' || typeof composer.getSubdivisions !== 'function' || typeof composer.getSubsubdivs !== 'function' || typeof composer.getMeter !== 'function') {
      try {
        const _fs = require('fs'); const _path = require('path');
        const payload = { when: new Date().toISOString(), phase: 'select-composer', composerType: (composer && composer.constructor && composer.constructor.name) ? composer.constructor.name : typeof composer, hasGetDivisions: composer && typeof composer.getDivisions === 'function', hasGetSubdivisions: composer && typeof composer.getSubdivisions === 'function', hasGetSubsubdivs: composer && typeof composer.getSubsubdivs === 'function', hasGetMeter: composer && typeof composer.getMeter === 'function', composersSnapshot: (Array.isArray(composers) ? composers.map(c => (c && c.constructor && c.constructor.name) ? c.constructor.name : (typeof c)) : null), stack: (new Error()).stack };
        _fs.appendFileSync(_path.join(process.cwd(), 'output', 'composer-selection-errors.ndjson'), JSON.stringify(payload) + '\n');
      } catch (e) {}
      throw new Error('composer selection invalid: missing getters');
    }
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
          // Trace pre-division state (temporary debug)
          try {
            const _fs = require('fs'); const _path = require('path');
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
            _fs.appendFileSync(_path.join(process.cwd(), 'output', 'index-traces.ndjson'), JSON.stringify(trace) + '\n');
          } catch (_e) {}

          setUnitTiming('division');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            stage.playNotes();

            // Subsubdivisions are children of subdivisions; iterate inside subdivision loop
            for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdivision');
              stage.playNotes2();
              if (subsubdivIndex + 1 === subsubsPerSub) resetIndexWithChildren('subsubdivision');
            }

            if (subdivIndex + 1 === subdivsPerDiv) resetIndexWithChildren('subdivision');
          }

          // Trace post-subdivision summary (temporary debug)
          try {
            const _fs = require('fs'); const _path = require('path');
            const after = { when: new Date().toISOString(), layer: 'primary', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, divsPerBeat, subdivsPerDiv };
            _fs.appendFileSync(_path.join(process.cwd(), 'output', 'index-traces.ndjson'), JSON.stringify(after) + '\n');
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
            const _fs = require('fs'); const _path = require('path');
            const trace = {
              when: new Date().toISOString(), layer: 'poly', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, divsPerBeat, subdivsPerDiv,
              // Avoid calling composer getters here to prevent flip/flop between calls; use clamped values from time.js instead
              composerDivisions: null,
              composerSubdivisions: null
            };
            _fs.appendFileSync(_path.join(process.cwd(), 'output', 'index-traces.ndjson'), JSON.stringify(trace) + '\n');
          } catch (_e) {}

          setUnitTiming('division');

          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdivision');
            stage.playNotes();

            // Subsubdivisions belong to a subdivision; iterate here
            for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdivision');
              stage.playNotes2();
              if (subsubdivIndex + 1 === subsubsPerSub) resetIndexWithChildren('subsubdivision');
            }

            if (subdivIndex + 1 === subdivsPerDiv) resetIndexWithChildren('subdivision');
          }

          // Trace post-subdivision summary (temporary debug)
          try {
            const _fs = require('fs'); const _path = require('path');
            const after = { when: new Date().toISOString(), layer: 'poly', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, divsPerBeat, subdivsPerDiv };
            _fs.appendFileSync(_path.join(process.cwd(), 'output', 'index-traces.ndjson'), JSON.stringify(after) + '\n');
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
  logUnit('section');

  LM.advance('poly', 'section');
  logUnit('section');
  if (sectionIndex + 1 === totalSections) resetIndexWithChildren('section');
  BPM=BASE_BPM;
  activeMotif=null;
}

grandFinale();
