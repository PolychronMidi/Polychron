/* exported MotifSpreader */
// motifSpreader.js - centralize planning of motif groups across a measure
var MotifSpreader;
// Generates motif groups (min-max beats) and populates layer.beatMotifs accordingly

MotifSpreader = {
  spreadMeasure({ layer, measureStart, measureBeats, composer }) {
    try {
      if (!layer) return;
      const measureB = Number.isFinite(Number(measureBeats)) ? Number(measureBeats) : 0;
      let remaining = measureB;
      const groups = [];
      const min = 2; const max = 7;
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

      // distribute motif steps across beats WITHOUT absolute ticks
      const baseBeat = Math.floor(measureStart / beatLen);
      groups.forEach((gLen, groupIdx) => {
        const mcGroup = new MotifComposer({ useVoiceLeading: !!(composer && composer.voiceLeading) });
        const length = ri(min, Math.max(1, Math.min(8, gLen * min)));
        const motifGroup = mcGroup.generate({ length, fitToTotalTicks: true, totalTicks: gLen * beatLen, developFromComposer: composer, measureComposer: composer });
        const seq = motifGroup.sequence || motifGroup.events || [];
        const totalEvents = seq.length || 0;
        const groupId = `${measureStart}-${beatOffset}-${gLen}-${groupIdx}`;
        for (let i = 0; i < totalEvents; i++) {
          const evt = seq[i];
          const relativeBeat = Math.floor((i * gLen) / Math.max(1, totalEvents));
          const bKey = baseBeat + beatOffset + relativeBeat;
          layer.beatMotifs = layer.beatMotifs || {};
          layer.beatMotifs[bKey] = layer.beatMotifs[bKey] || [];
          layer.beatMotifs[bKey].push({ note: Number(evt.note), groupId, seqIndex: i, seqLen: totalEvents });
        }
        layer.activeMotif = motifGroup;
        beatOffset += gLen;
      });

    } catch (e) { /* swallow */ }
  },

  // Return up to `max` motif steps from a beat bucket using a per-beat modulo cursor
  getBeatMotifPicks(layer, beatKey, max = 1) {
    if (!layer || !layer.beatMotifs) return [];
    const bucket = Array.isArray(layer.beatMotifs[beatKey]) ? layer.beatMotifs[beatKey] : [];
    if (!bucket.length) return [];

    layer._motifCursor = layer._motifCursor || {};
    let cursor = Number.isFinite(layer._motifCursor[beatKey]) ? layer._motifCursor[beatKey] : 0;

    const picks = [];
    for (let i = 0; i < max; i++) {
      const idx = (cursor + i) % bucket.length;
      const step = bucket[idx];
      picks.push({ note: Number(step.note), groupId: step.groupId, seqIndex: step.seqIndex, seqLen: step.seqLen });
    }

    layer._motifCursor[beatKey] = (cursor + max) % bucket.length;
    return picks;
  }
};
