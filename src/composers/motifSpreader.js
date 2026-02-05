/* exported MotifSpreader */
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
      // Reset per-measure debug tracking when planning a measure
      if (layer && layer._loggedEmptyBeatKeys) layer._loggedEmptyBeatKeys = new Set();

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
            layer.beatMotifs[bKey].push({ note: Number(evt.note), groupId, seqIndex: i, seqLen: totalEvents });
            added++;
          }
        }
        layer.activeMotif = motifGroup;
        beatOffset += gLen;
      });



    } catch (e) { console.warn('MotifSpreader.spreadMeasure failed for measureStart ' + measureStart + ' (continuing):', e && e.stack ? e.stack : e); }
  },

  // Return up to `max` motif steps from a beat bucket using a per-beat modulo cursor
  getBeatMotifPicks(layer, beatKey, max = 1, opts = {}) {
    if (!layer || !layer.beatMotifs) return [];
    const bucket = Array.isArray(layer.beatMotifs[beatKey]) ? layer.beatMotifs[beatKey] : [];
    if (!bucket.length) return [];

    layer._motifCursor = layer._motifCursor || {};
    let cursor = Number.isFinite(layer._motifCursor[beatKey]) ? layer._motifCursor[beatKey] : 0;

    const picks = [];

    for (let i = 0; i < max; i++) {
      // If a MeasureComposer with voice leading is present on the layer, prefer it
      let chosenStep = null;

      try {
        if (layer.measureComposer && typeof layer.measureComposer.selectNoteWithLeading === 'function') {
          // pick using the measure composer's voice-leading selection
          const candidates = bucket.map(s => Number(s.note));
          const chosenNote = layer.measureComposer.selectNoteWithLeading(candidates, opts.voiceOptions || {});
          // prefer the first candidate step matching the chosen note that starts at or after cursor
          const startIdx = cursor % bucket.length;
          for (let k = 0; k < bucket.length; k++) {
            const idx = (startIdx + k) % bucket.length;
            if (Number(bucket[idx].note) === chosenNote) { chosenStep = bucket[idx]; cursor = (idx + 1) % bucket.length; break; }
          }
        }
      } catch (e) { /* fall through to other strategies */ }

      // If no MeasureComposer choice, but a layer-level VoiceLeadingScore exists, use it
      if (!chosenStep && layer.VoiceLeadingScore && typeof layer.VoiceLeadingScore.selectNextNote === 'function') {
        const candidates = bucket.map(s => Number(s.note));
        const chosenNote = layer.VoiceLeadingScore.selectNextNote(layer._voiceHistory || [], candidates, opts.voiceOptions || {});
        const startIdx = cursor % bucket.length;
        for (let k = 0; k < bucket.length; k++) {
          const idx = (startIdx + k) % bucket.length;
          if (Number(bucket[idx].note) === chosenNote) { chosenStep = bucket[idx]; cursor = (idx + 1) % bucket.length; break; }
        }
      }

      // Fallback: simple cursor-based selection
      if (!chosenStep) {
        const idx = (cursor + i) % bucket.length;
        chosenStep = bucket[idx];
        cursor = (idx + 1) % bucket.length;
      }

      picks.push({ note: Number(chosenStep.note), groupId: chosenStep.groupId, seqIndex: chosenStep.seqIndex, seqLen: chosenStep.seqLen });

      // Track per-layer minimal voice history for layer.VoiceLeadingScore use
      if (!layer._voiceHistory) layer._voiceHistory = [];
      layer._voiceHistory.unshift(Number(chosenStep.note));
      if (layer._voiceHistory.length > 8) layer._voiceHistory.pop();
    }

    layer._motifCursor[beatKey] = cursor % bucket.length;
    return picks;
  }
};
