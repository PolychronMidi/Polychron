// playMotifs.js - Motif-driven note selection and transformation
// Handles multi-level bucket retrieval (beat/div/subdiv/subsubdiv), cycle tracking,
// transformations, sibling voice enforcement, and voice coordination
//
// CANDIDATE GENERATION FLOW:
// 1. Resolve target bucket from the appropriate unit-level motif array
// 2. Extract note from bucket entry (pre-generated at planning time)
// 3. Validate MIDI range and clamp if needed
// 4. Expand pool via CandidateExpansion.expandScaleAware if < 3 candidates (scale-aware neighbors)
// 5. Filter to current composer's pitch classes (prevents stale notes from previous composer)
// 6. Enforce sibling voice limits (constrain candidates to established sibling PCs when full)
// 7. Optional: filter via HarmonicContext.isNoteInScale (only if it preserves composer PCs)
// 8. Delegate selection to VoiceManager.pickNotesForBeat with:
//    - voiceCount from VOICES config
//    - composer.getVoicingIntent() for candidate weights
//    - VoiceLeadingScore for smooth motion
//    - phraseContext for arc-driven biases
// 9. Validate all picks belong to composer's pitch-class set (fail-fast if VoiceManager error)
// 10. Register picked PCs in sibling voice tracking
// 11. Track cycle completion and apply MotifTransforms after each full cycle

playMotifs = /** @type {any} */ (function playMotifs(unit = 'subdiv', layer) {
  // Validate layer
  if (!layer) throw new Error(`${unit}.playMotifs missing layer`);
  if (typeof playMotifsResolveBucket !== 'function') {
    throw new Error(`${unit}.playMotifs: playMotifsResolveBucket helper not available`);
  }
  if (typeof playMotifsBuildCandidateNotes !== 'function') {
    throw new Error(`${unit}.playMotifs: playMotifsBuildCandidateNotes helper not available`);
  }
  if (typeof playMotifsApplyCycleTransforms !== 'function') {
    throw new Error(`${unit}.playMotifs: playMotifsApplyCycleTransforms helper not available`);
  }

  const resolvedBucket = playMotifsResolveBucket(unit, layer);
  const targetIndex = resolvedBucket.targetIndex;
  const bucket = resolvedBucket.bucket;
  const cursorMap = resolvedBucket.cursorMap;

  // Track motif cycle completion per groupId and apply transformations after each cycle
  if (!layer._motifCycleTracking) layer._motifCycleTracking = new Map();
  const cycleTracker = layer._motifCycleTracking;

  // Check if any groups completed a cycle and need transformation
  const groupsToCheck = new Set(bucket.map(entry => entry.groupId).filter(g => g));
  for (const groupId of groupsToCheck) {
    if (!cycleTracker.has(groupId)) {
      const firstEntry = bucket.find(e => e.groupId === groupId);
      if (firstEntry && Number.isFinite(firstEntry.seqLen)) {
        cycleTracker.set(groupId, { playedIndices: new Set(), seqLen: firstEntry.seqLen, cycleCount: 0 });
      }
    }
  }

  // Pick next motif entry for this beat and cycle on each call
  const cursor = cursorMap.get(targetIndex) ?? 0;
  const bucketEntry = bucket[cursor % bucket.length];
  cursorMap.set(targetIndex, cursor + 1);
  if (!bucketEntry || !Number.isFinite(Number(bucketEntry.note))) {
    throw new Error(`${unit}.playMotifs: invalid bucket entry at cursor=${cursor} - entry: ${JSON.stringify(bucketEntry)}`);
  }
  // Apply working overrides (non-destructive cycle transforms) if available
  const overrideKey = bucketEntry.groupId && Number.isFinite(bucketEntry.seqIndex) ? `${bucketEntry.groupId}:${bucketEntry.seqIndex}` : null;
  const resolvedNote = (overrideKey && layer._workingOverrides && layer._workingOverrides.has(overrideKey))
    ? layer._workingOverrides.get(overrideKey)
    : bucketEntry.note;

  if (typeof LM.activeLayer !== 'string' || LM.activeLayer.length === 0) {
    throw new Error(`${unit}.playMotifs: LayerManager.activeLayer is not set`);
  }
  const activeLayer = LM.layers[LM.activeLayer];
  if (!activeLayer || typeof activeLayer !== 'object') {
    throw new Error(`${unit}.playMotifs: active layer "${LM.activeLayer}" not found`);
  }
  const activeComposer = LM.getComposerFor(LM.activeLayer);

  // Extract valid PCs from active composer
  const composerValidPCs = scaleNormalization.collectComposerValidPCs(activeComposer, {
    preferTimeVaryingContext: true,
    label: `${unit}.playMotifs`
  });

  const candidateNotes = playMotifsBuildCandidateNotes(unit, resolvedNote, composerValidPCs);

  // Per-unit VoiceManager: maintain separate voice histories per unit level
  // so subdiv voice-leading doesn't pollute beat-level motion.
  // Parent histories seed children for coherence at each new parent boundary.
  if (!layer._voiceManagers) layer._voiceManagers = {};
  if (!layer._voiceManagers[unit]) {
    layer._voiceManagers[unit] = new VoiceManager();
    // Seed from parent unit's history for coherence
    const parentUnit = unit === 'subsubdiv' ? 'subdiv' : unit === 'subdiv' ? 'div' : unit === 'div' ? 'beat' : null;
    if (parentUnit && layer._voiceManagers[parentUnit]) {
      const parentVM = layer._voiceManagers[parentUnit];
      const layerId = (layer && typeof layer.id === 'string' && layer.id.length > 0) ? layer.id : 'default';
      const parentHistory = parentVM.voiceHistoryByLayer.get(layerId);
      if (Array.isArray(parentHistory) && parentHistory.length > 0) {
        layer._voiceManagers[unit].voiceHistoryByLayer.set(layerId, parentHistory.map(h => Array.isArray(h) ? [...h] : []));
      }
    }
  }
  const VC = layer._voiceManagers[unit];
  const voiceCount = VC.getVoiceCount(unit);
  const scorer = activeComposer?.VoiceLeadingScore || layer.VoiceLeadingScore;
  const runtimeProfile = (activeComposer && activeComposer.runtimeProfile && typeof activeComposer.runtimeProfile === 'object')
    ? activeComposer.runtimeProfile
    : null;
  const runtimeVoiceOptions = (runtimeProfile && ComposerRuntimeProfileAdapter && typeof ComposerRuntimeProfileAdapter.getVoiceSelectionOptions === 'function')
    ? ComposerRuntimeProfileAdapter.getVoiceSelectionOptions(runtimeProfile)
    : {};

  // Get phrase context from PhraseArcManager if available
  let phraseContext = null;
  if (ComposerFactory && ComposerFactory.sharedPhraseArcManager) {
    phraseContext = ComposerFactory.sharedPhraseArcManager.getPhraseContext();
  }

  // Pass voicing options from composer for voice spacing constraints
  const voicingOptions = (activeComposer && typeof activeComposer.voicingOptions === 'object') ? activeComposer.voicingOptions : {};
  const rawPicks = VC.pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, Object.assign({ phraseContext }, voicingOptions, runtimeVoiceOptions, runtimeProfile ? { runtimeProfile } : {}));
  if (!Array.isArray(rawPicks)) {
    throw new Error(`${unit}.playMotifs: VoiceManager.pickNotesForBeat returned non-array value`);
  }
  const picks = rawPicks.map((note, idx) => {
    if (!Number.isFinite(Number(note))) throw new Error(`${unit}.playMotifs: VoiceManager returned invalid pick at index ${idx}: ${JSON.stringify(note)}`);
    return { note: Number(note) };
  });

  // VALIDATE all picks before proceeding - catch VoiceManager returning invalid notes
  if (composerValidPCs.size > 0) {
    for (let pi = 0; pi < picks.length; pi++) {
      const pickPC = ((picks[pi].note % 12) + 12) % 12;
      if (!composerValidPCs.has(pickPC)) {
        throw new Error(`${unit}.playMotifs: VoiceManager returned invalid pick note ${picks[pi].note} (PC ${pickPC}) not in composer PCs [${Array.from(composerValidPCs).sort((a,b)=>a-b).join(',')}]`);
      }
    }
  }

  // Track which motif indices are being played this beat
  const playedGroupIndices = new Map();
  if (bucketEntry && bucketEntry.groupId && Number.isFinite(bucketEntry.seqIndex)) {
    playedGroupIndices.set(bucketEntry.groupId, [bucketEntry.seqIndex]);
  }

  playMotifsApplyCycleTransforms(layer, bucket, playedGroupIndices, cycleTracker, /** @type {any} */ (playMotifs)._cloneBucketEntry);

  // Filter duplicate notes only within this unit call (do not gate later subunits in same beat)
  const seenNotesThisUnit = new Set();
  const filteredPicks = picks.filter(s => {
    if (seenNotesThisUnit.has(s.note)) return false;
    seenNotesThisUnit.add(s.note);
    return true;
  });

  return filteredPicks;
});

/**
 * Deep clone a bucket entry (preserve original, transform copy)
 */
/** @type {any} */ (playMotifs)._cloneBucketEntry = function(entry) {
  return {
    note: entry.note,
    duration: entry.duration,
    groupId: entry.groupId,
    seqIndex: entry.seqIndex,
    seqLen: entry.seqLen
  };
};

/**
 * Reset all internal layer state (call at phrase/section boundaries)
 * Clears beatNoteHistory, motifCycleTracking, and voice Manager history
 */
/** @type {any} */ (playMotifs).resetLayerState = function(layer) {
  if (!layer) return;
  layer._motifCycleTracking = null;
  layer._emptyBucketCaptured = null;
  layer._bucketCursors = null;
  layer._workingOverrides = null;
  // Clear all hierarchical motif buckets to avoid stale notes across phrases
  layer.measureMotifs = null;
  layer.beatMotifs = [];
  layer.divMotifs = [];
  layer.subdivMotifs = [];
  layer.subsubdivMotifs = [];
  // Clear sibling voice tracking
  layer._siblingVoicePCs = null;
  layer._siblingVoiceLimits = null;
  // DO NOT reset _voiceManagers here; they maintain voice leading continuity within a phrase
  // Sub-unit VMs are re-seeded from parent at each parent boundary automatically
};
