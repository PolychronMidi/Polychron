// playMotifsApplyCycleTransforms.js - cycle tracking and transform application for playMotifs

playMotifsApplyCycleTransforms = function playMotifsApplyCycleTransforms(layer, bucket, playedGroupIndices, cycleTracker, cloneEntryFn) {
  for (const [groupId, indices] of playedGroupIndices) {
    const tracking = cycleTracker.get(groupId);
    if (!tracking) continue;

    for (const idx of indices) tracking.playedIndices.add(idx);

    if (tracking.playedIndices.size >= tracking.seqLen) {
      tracking.cycleCount++;
      tracking.playedIndices.clear();

      const groupEntries = bucket.filter(e => e.groupId === groupId).map(e => cloneEntryFn(e));
      if (groupEntries.length > 0) {
        if (rf() >= 0.05) {
          try {
            const transforms = motifTransforms.selectRandom(groupEntries.length);
            motifTransforms.applyAll(groupEntries, transforms);
          } catch (e) {
            throw new Error(`playMotifs: transformation failed for groupId ${groupId}: ${e && e.message ? e.message : e}`);
          }
        }

        if (!layer._workingOverrides) layer._workingOverrides = new Map();
        for (let i = 0; i < groupEntries.length; i++) {
          const ge = groupEntries[i];
          layer._workingOverrides.set(`${ge.groupId}:${ge.seqIndex}`, ge.note);
        }
      }
    }
  }
};
