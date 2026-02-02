// motifSpreader.js - centralize planning of motif groups across a measure
// Generates motif groups (min-max beats) and populates layer.beatMotifs accordingly

MotifSpreader = {
  spreadMeasure({ layer, measureStart, measureBeats, composer }) {
    try {
      if (!layer) return;
      const measureB = Number.isFinite(Number(measureBeats)) ? Number(measureBeats) : 0;
      let remaining = measureB;
      const groups = [];
      const min = 1; const max = 5;
      // Ensure group sizes are between min and max beats where possible
      if (remaining <= max) {
        // small measure: one group (can be 1 if measure is 1-beat)
        groups.push(remaining);
      } else {
        while (remaining > max) {
          let pick = ri(min, max);
          // avoid leaving a remainder smaller than min
          if (remaining - pick < min) {
            pick = remaining - min; // safe because remaining > max => remaining-min >= 6
            if (pick > max) pick = max;
          }
          groups.push(pick);
          remaining -= pick;
        }
        if (remaining > 0) groups.push(remaining);
      }

      let beatOffset = 0;
      const beatLen = (typeof tpBeat !== 'undefined' && Number.isFinite(Number(tpBeat)) && Number(tpBeat) > 0) ? Number(tpBeat) : 1;

      groups.forEach((gLen) => {
        const groupStartTick = measureStart + beatOffset * beatLen;
        const groupTicks = gLen * beatLen;
        const mcGroup = new MotifComposer({ useVoiceLeading: !!(composer && composer.voiceLeading) });
        const length = ri(min, Math.max(1, Math.min(8, gLen * min)));
        const motifGroup = mcGroup.generate({ length, fitToTotalTicks: true, totalTicks: groupTicks, developFromComposer: composer, measureComposer: composer });

        const scheduleG = [];
        let cursorG = groupStartTick;
        (motifGroup.sequence || motifGroup.events || []).forEach((evt) => {
          const dur = Number(evt.duration) || Math.max(1, Math.round(Number(tpSubdiv) || 30));
          scheduleG.push({ note: Number(evt.note), startTick: cursorG, duration: dur });
          cursorG += dur;
        });

        scheduleG.forEach((evt) => {
          const bKey = Math.floor(evt.startTick / beatLen);
          layer.beatMotifs = layer.beatMotifs || {};
          layer.beatMotifs[bKey] = layer.beatMotifs[bKey] || [];
          layer.beatMotifs[bKey].push(evt);
        });

        layer.activeMotif = motifGroup;
        beatOffset += gLen;
      });

    } catch (e) { /* swallow */ }
  }
};

// Expose for tests & legacy access
try { if (typeof __POLYCHRON_TEST__ === 'undefined') __POLYCHRON_TEST__ = {}; } catch (e) { /* swallow */ }
try { if (__POLYCHRON_TEST__) __POLYCHRON_TEST__.MotifSpreader = MotifSpreader; } catch (e) { /* swallow */ }
