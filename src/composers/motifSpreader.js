// motifSpreader.js - centralize planning of motif groups across a measure
// Generates motif groups (min-max beats) and populates layer.beatMotifs accordingly

MotifSpreader = {
  spreadMeasure({ layer, measureStart, measureBeats, composer }) {
    try {
      if (!layer) { console.warn('MotifSpreader.spreadMeasure: no layer provided — skipping'); return; }
      const measureB = Number.isFinite(Number(measureBeats)) ? Number(measureBeats) : 0;
      let remaining = measureB;
      const groups = [];
      const min = 1; const max = 3;
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
      let added = 0;
      const beatLen = (typeof tpBeat !== 'undefined' && Number.isFinite(Number(tpBeat)) && Number(tpBeat) > 0) ? Number(tpBeat) : 1;

      // Add group's steps as candidates on every beat of the group's span;
      // placement/length/offset is decided later by stage/main loops.
      const baseBeat = Math.floor(measureStart / beatLen);
      groups.forEach((gLen, groupIdx) => {
        const mcGroup = new MotifComposer({ useVoiceLeading: Boolean(composer && composer.VoiceLeadingScore) });
        const length = ri(min, Math.max(1, Math.min(8, gLen * min)));
        const motifGroup = mcGroup.generate({ length, fitToTotalTicks: true, totalTicks: gLen * beatLen, developFromComposer: composer, measureComposer: composer });
        const seq = motifGroup.sequence || motifGroup.events || [];
        const totalEvents = seq.length || 0;
        const groupId = `${measureStart}-${beatOffset}-${gLen}-${groupIdx}`;
        layer.beatMotifs = layer.beatMotifs || {};
        // If the generated motif group contains no events, skip creating empty beat buckets
        if (!totalEvents) {
          console.warn('MotifSpreader.spreadMeasure: generated empty motif group, skipping', { measureStart, groupIdx, gLen });
          beatOffset += gLen;
          return; // exit this group iteration (forEach callback)
        }

        for (let b = 0; b < gLen; b++) {
          const bKey = baseBeat + beatOffset + b;
          layer.beatMotifs[bKey] = layer.beatMotifs[bKey] || [];
          for (let i = 0; i < totalEvents; i++) {
            const evt = seq[i];
            const noteValue = Number(evt.note);
            // Clamp to valid MIDI range 0-127 before adding to bucket
            const clampedNote = modClamp(noteValue, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
            layer.beatMotifs[bKey].push({ note: clampedNote, groupId, seqIndex: i, seqLen: totalEvents });
            added++;
          }
        }
        layer.activeMotif = motifGroup;
        beatOffset += gLen;
      });

    } catch (e) { console.warn('MotifSpreader.spreadMeasure failed for measureStart ' + measureStart + ' (continuing):', e && e.stack ? e.stack : e); }
  },

};
