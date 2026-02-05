/* exported MotifSpreader, globalVoiceCoordinator */
// motifSpreader.js - centralize planning of motif groups across a measure

// Generates motif groups (min-max beats) and populates layer.beatMotifs accordingly

// Shared VoiceCoordinator instance for centralized voice selection
globalVoiceCoordinator = new VoiceCoordinator();

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
            layer.beatMotifs[bKey].push({ note: Number(evt.note), groupId, seqIndex: i, seqLen: totalEvents });
            added++;
          }
        }
        layer.activeMotif = motifGroup;
        beatOffset += gLen;
      });

    } catch (e) { console.warn('MotifSpreader.spreadMeasure failed for measureStart ' + measureStart + ' (continuing):', e && e.stack ? e.stack : e); }
  },

  // Return up to `max` motif steps from a beat bucket using centralized voice coordination
  getBeatMotifPicks(layer, beatKey, max = 1, opts = {}) {
    if (!layer || !layer.beatMotifs) return [];
    const bucket = Array.isArray(layer.beatMotifs[beatKey]) ? layer.beatMotifs[beatKey] : [];
    if (!bucket.length) return [];

    // Extract candidate notes from bucket
    const candidateNotes = bucket.map(s => Number(s.note));

    // Get voice count (use max as hint but apply VOICES config)
    const voiceCount = Math.min(max, globalVoiceCoordinator.getVoiceCount());

    // Get scorer from layer's measureComposer if available
    const scorer = layer.measureComposer?.VoiceLeadingScore || layer.VoiceLeadingScore;

    // Use VoiceCoordinator for selection
    const selectedNotes = globalVoiceCoordinator.pickNotesForBeat(
      layer,
      candidateNotes,
      voiceCount,
      scorer,
      opts.voiceOptions || {}
    );

    // Map selected notes back to bucket entries with metadata
    const picks = [];
    const usedIndices = new Set();
    for (const note of selectedNotes) {
      const matchIndex = bucket.findIndex((s, idx) => !usedIndices.has(idx) && Number(s.note) === note);
      if (matchIndex >= 0) {
        usedIndices.add(matchIndex);
        const match = bucket[matchIndex];
        picks.push({
          note: Number(match.note),
          groupId: match.groupId,
          seqIndex: match.seqIndex,
          seqLen: match.seqLen
        });
      }
    }

    return picks;
  }
};
