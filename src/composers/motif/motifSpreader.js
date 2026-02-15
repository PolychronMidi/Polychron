// motifSpreader.js - centralize planning of motif groups across a measure
// Generates motif groups (min-max beats) and populates layer.beatMotifs accordingly

MotifSpreader = {
  spreadMeasure({ layer, measureStart, measureBeats, composer }) {
    try {
      if (!layer) throw new Error('MotifSpreader.spreadMeasure: no layer provided - fail-fast');
      if (!Number.isFinite(Number(measureBeats))) throw new Error(`MotifSpreader.spreadMeasure: invalid measureBeats=${measureBeats} - fail-fast`);
      const measureB = Number(measureBeats);
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
      // Add group steps to LOCAL beat buckets (0..numerator-1).
      // Scope: motifSpreader only plans/group-distributes motif entries.
      groups.forEach((gLen, groupIdx) => {
        const mcGroup = new MotifComposer({ useVoiceLeading: Boolean(composer && composer.VoiceLeadingScore) });
        const minEventsPerGroup = m.max(2, gLen * 2);
        const maxEventsPerGroup = m.max(minEventsPerGroup, m.min(16, gLen * 6));
        const length = ri(minEventsPerGroup, maxEventsPerGroup);
        const motifGroup = mcGroup.generate({ length, developFromComposer: composer, measureComposer: composer });
        if (!motifGroup || (!motifGroup.sequence && !motifGroup.events)) {
          throw new Error('MotifSpreader.spreadMeasure: MotifComposer.generate() returned invalid structure - fail-fast');
        }
        const seq = motifGroup.sequence || motifGroup.events;
        if (!Array.isArray(seq)) throw new Error('MotifSpreader.spreadMeasure: motif sequence is not an array - fail-fast');
        const totalEvents = seq.length;
        const groupId = `${measureStart}-${beatOffset}-${gLen}-${groupIdx}`;
        if (!layer.beatMotifs) throw new Error('MotifSpreader.spreadMeasure: layer.beatMotifs not initialized - fail-fast');

        // ALWAYS create beat buckets for this group's beats, using LOCAL beat indices.
        // playMotifs expects every beat to have a key in layer.beatMotifs.
        for (let b = 0; b < gLen; b++) {
          const bKey = beatOffset + b;  // LOCAL beat index, not absolute
          // CLEAR previous bucket for this beat to prevent stale notes from old composer.
          layer.beatMotifs[bKey] = [];
        }

        // Distribute motif events across group beats (round-robin by event index).
        // Timing conversion is intentionally out-of-scope for MotifSpreader.
        if (totalEvents > 0) {
          for (let i = 0; i < totalEvents; i++) {
            const evt = seq[i];
            const noteValue = Number(evt.note);
            if (!Number.isFinite(noteValue)) {
              throw new Error(`MotifSpreader: motif event ${i} produced non-finite note value`);
            }
            const localBeat = i % gLen;
            const bKey = beatOffset + localBeat;

            layer.beatMotifs[bKey].push({ note: noteValue, groupId, seqIndex: i, seqLen: totalEvents });
          }

          // Safety: if any beat bucket ended up empty, seed it from a neighboring motif step.
          for (let b = 0; b < gLen; b++) {
            const bKey = beatOffset + b;
            if (!Array.isArray(layer.beatMotifs[bKey]) || layer.beatMotifs[bKey].length > 0) continue;

            const seedIdx = m.min(totalEvents - 1, m.floor((b / m.max(1, gLen - 1)) * (totalEvents - 1)));
            const seedEvt = seq[seedIdx];
            const seedNote = Number(seedEvt.note);
            if (!Number.isFinite(seedNote)) {
              throw new Error(`MotifSpreader: seed motif event produced non-finite note value at index ${seedIdx}`);
            }
            layer.beatMotifs[bKey] = [{ note: seedNote, groupId, seqIndex: seedIdx, seqLen: totalEvents }];
          }
        }
        layer.activeMotif = motifGroup;
        beatOffset += gLen;
      });

    } catch (e) {
      throw e;
    }
  },

};
