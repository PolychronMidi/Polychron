// play.js - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md
require('./stage'); // This file imports EVERY other file & dependency in the project - Global scope used by design: DO NOT spam up files with useless import / export statements
(async function main() { console.log('Starting play.js ...');

const { layer: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => setTuningAndInstruments());
const { layer: poly, buffer: c2 } = LM.register('poly', 'c2', {}, () => setTuningAndInstruments());

totalSections = ri(SECTIONS.min, SECTIONS.max);
for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  // Initialize each layer's section origin so relative ticks are correct and explicit
  LM.setSectionStartAll();

  // Explicitly log a `section` marker for both layers so Section 1 is present
  // for both `primary` and `poly` outputs. Restore `primary` as active for
  // the phrase loop immediately after logging.
  LM.activate('primary', false);
  setUnitTiming('section');
  // Activate poly without setting `isPoly` yet (poly meter isn't known until later)
  LM.activate('poly', false);
  setUnitTiming('section');
  LM.activate('primary', false);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    composer = ComposerFactory.createRandom({ root: 'random' });
    [numerator, denominator] = composer.getMeter();
    // Activate primary layer first so activation doesn't overwrite freshly computed timing
    LM.activate('primary', false);
    getMidiTiming();
    getPolyrhythm();
    measuresPerPhrase = measuresPerPhrase1;
    setUnitTiming('phrase');

    // Generate an active motif for this phrase that fits the phrase duration
    try {
      // Allow composer to seed motif generation when possible
      const mc = new MotifComposer({ useVoiceLeading: !!(composer && composer.voiceLeading) });
      const phraseTicks = Number(tpMeasure) * Number(measuresPerPhrase);
      const length = ri(2, Math.max(2, Math.min(8, measuresPerPhrase * 2)));
      const motif = mc.generate({ length, fitToTotalTicks: true, totalTicks: phraseTicks, developFromComposer: composer, measureComposer: composer });
      // Store both legacy global and per-layer schedule for playback
      activeMotif = motif;
      try {
        const schedule = [];
        let cursor = Number(phraseStart) || 0;
        (motif.sequence || motif.events || []).forEach((evt) => {
          const dur = Number(evt.duration) || Math.max(1, Math.round(Number(tpSubdiv) || 30));
          schedule.push({ note: Number(evt.note), startTick: cursor, duration: dur });
          cursor += dur;
        });
        const layer = LM.layers[LM.activeLayer];
        if (layer) {
          layer.activeMotif = motif;
          layer.motifSchedule = schedule;
          // Group scheduled motif events into per-beat buckets for runtime pickup
          try {
            layer.beatMotifs = layer.beatMotifs || {};
            const beatLen = (typeof tpBeat !== 'undefined' && Number.isFinite(Number(tpBeat)) && Number(tpBeat) > 0) ? Number(tpBeat) : 1;
            schedule.forEach((evt) => {
              const startTick = Number(evt.startTick);
              const beatKey = Math.floor(startTick / beatLen);
              layer.beatMotifs[beatKey] = layer.beatMotifs[beatKey] || [];
              layer.beatMotifs[beatKey].push({ ...evt, startTick });
            });
          } catch (_e) { /* swallow */ }
        }
      } catch (_e) { /* swallow */ }
    } catch (e) { /* swallow - motif generation is best-effort */ }


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
            playSubdivNotes();
            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              playSubsubdivNotes();
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

    // Generate a poly-layer motif for this poly-phrase as well
    try {
      const mc2 = new MotifComposer({ useVoiceLeading: !!(composer && composer.voiceLeading) });
      const phraseTicks2 = Number(tpMeasure) * Number(measuresPerPhrase);
      const length2 = ri(2, Math.max(2, Math.min(8, measuresPerPhrase * 2)));
      const motif2 = mc2.generate({ length: length2, fitToTotalTicks: true, totalTicks: phraseTicks2, developFromComposer: composer, measureComposer: composer });
      activeMotif = motif2;
      try {
        const schedule2 = [];
        let cursor2 = Number(phraseStart) || 0;
        (motif2.sequence || motif2.events || []).forEach((evt) => {
          const dur = Number(evt.duration) || Math.max(1, Math.round(Number(tpSubdiv) || 30));
          schedule2.push({ note: Number(evt.note), startTick: cursor2, duration: dur });
          cursor2 += dur;
        });
        const layer2 = LM.layers[LM.activeLayer];
        if (layer2) {
          layer2.activeMotif = motif2;
          layer2.motifSchedule = schedule2;
          // Group scheduled motif events into per-beat buckets for runtime pickup
          try {
            layer2.beatMotifs = layer2.beatMotifs || {};
            const beatLen2 = (typeof tpBeat !== 'undefined' && Number.isFinite(Number(tpBeat)) && Number(tpBeat) > 0) ? Number(tpBeat) : 1;
            schedule2.forEach((evt) => {
              const startTick2 = Number(evt.startTick);
              const beatKey2 = Math.floor(startTick2 / beatLen2);
              layer2.beatMotifs[beatKey2] = layer2.beatMotifs[beatKey2] || [];
              layer2.beatMotifs[beatKey2].push({ ...evt, startTick: startTick2 });
            });
          } catch (_e) { /* swallow */ }
        }
      } catch (_e) { /* swallow */ }
    } catch (e) { /* swallow */ }

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
            playSubdivNotes();

            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              playSubsubdivNotes();
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
