// playMotifs.js - Motif-driven note selection and transformation
// Handles multi-level bucket retrieval (beat/div/subdiv/subsubdiv), cycle tracking,
// transformations, sibling voice enforcement, and voice coordination
//
// CANDIDATE GENERATION FLOW:
// 1. Resolve target bucket from the appropriate unit-level motif array
// 2. Extract note from bucket entry (pre-generated at planning time)
// 3. Validate MIDI range and clamp if needed
// 4. Expand pool via candidateExpansion.expandScaleAware if < 3 candidates (scale-aware neighbors)
// 5. Filter to current composer's pitch classes (prevents stale notes from previous composer)
// 6. Enforce sibling voice limits (constrain candidates to established sibling PCs when full)
// 7. Optional: filter via harmonicContext.isNoteInScale (only if it preserves composer PCs)
// 8. Delegate selection to VoiceManager.pickNotesForBeat with:
//    - voiceCount from VOICES config
//    - composer.getVoicingIntent() for candidate weights
//    - VoiceLeadingScore for smooth motion
//    - phraseContext for arc-driven biases
// 9. Validate all picks belong to composer's pitch-class set (fail-fast if VoiceManager error)
// 10. Register picked PCs in sibling voice tracking
// 11. Track cycle completion and apply motifTransforms after each full cycle

const playMotifsV = validator.create('playMotifs');
const playMotifsRuntimeVoiceOptionsCache = new WeakMap();

function playMotifsGetRuntimeVoiceOptions(runtimeProfile) {
  if (!runtimeProfile) return null;
  const cached = playMotifsRuntimeVoiceOptionsCache.get(runtimeProfile);
  if (cached) return cached;
  const options = composerRuntimeProfileAdapter.getVoiceSelectionOptions(runtimeProfile);
  playMotifsRuntimeVoiceOptionsCache.set(runtimeProfile, options);
  return options;
}

playMotifs = /** @type {any} */ (function playMotifs(unit = 'subdiv', layer) {
  // Validate layer
  const V = playMotifsV;
  if (!layer) throw new Error(`${unit}.playMotifs missing layer`);
  const resolvedBucket = playMotifsResolveBucket(unit, layer);
  const targetIndex = resolvedBucket.targetIndex;
  const bucket = resolvedBucket.bucket;
  const cursorMap = resolvedBucket.cursorMap;

  // Track motif cycle completion per groupId and apply transformations after each cycle
  if (!layer.playMotifsMotifCycleTracking) layer.playMotifsMotifCycleTracking = new Map();
  const cycleTracker = layer.playMotifsMotifCycleTracking;

  // Register any new groups - avoids .map()/.filter()/Set allocation per micro-unit
  for (let bi = 0; bi < bucket.length; bi++) {
    const gid = bucket[bi].groupId;
    if (gid && !cycleTracker.has(gid)) {
      if (Number.isFinite(bucket[bi].seqLen)) {
        cycleTracker.set(gid, { playedIndices: new Set(), seqLen: bucket[bi].seqLen, cycleCount: 0 });
      }
    }
  }

  // Pick next motif entry for this beat and cycle on each call
  const cursor = cursorMap.get(targetIndex) ?? 0;
  const bucketEntry = bucket[cursor % bucket.length];
  cursorMap.set(targetIndex, cursor + 1);
  if (!bucketEntry) throw new Error(`${unit}.playMotifs: invalid bucket entry at cursor=${cursor} - entry: ${JSON.stringify(bucketEntry)}`);
  V.requireFinite(bucketEntry.note, 'bucketEntry.note');
  // Apply working overrides (non-destructive cycle transforms) if available
  const overrideKey = bucketEntry.groupId && Number.isFinite(bucketEntry.seqIndex) ? `${bucketEntry.groupId}:${bucketEntry.seqIndex}` : null;
  const resolvedNote = (overrideKey && layer.playMotifsWorkingOverrides && layer.playMotifsWorkingOverrides.has(overrideKey))
    ? layer.playMotifsWorkingOverrides.get(overrideKey)
    : bucketEntry.note;

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayerName = /** @type {string} */ (LM.activeLayer);
  const activeLayer = LM.layers[activeLayerName];
  if (!activeLayer) throw new Error(`${unit}.playMotifs: active layer "${activeLayerName}" not found`);
  V.assertObject(activeLayer, 'activeLayer');
  const activeComposer = LM.getComposerFor(activeLayerName);

  // Extract valid PCs from active composer
  const composerValidPCs = scaleNormalization.collectComposerValidPCs(activeComposer, {
    preferTimeVaryingContext: true,
    label: `${unit}.playMotifs`
  });

  const candidateNotes = playMotifsBuildCandidateNotes(unit, resolvedNote, composerValidPCs);

  // Per-unit VoiceManager: maintain separate voice histories per unit level
  // so subdiv voice-leading doesn't pollute beat-level motion.
  // Parent histories seed children for coherence at each new parent boundary.
  if (!layer.playMotifsVoiceManagers) layer.playMotifsVoiceManagers = {};
  if (!layer.playMotifsVoiceManagers[unit]) {
    layer.playMotifsVoiceManagers[unit] = new VoiceManager();
    // Seed from parent unit's history for coherence
    const parentUnit = unit === 'subsubdiv' ? 'subdiv' : unit === 'subdiv' ? 'div' : unit === 'div' ? 'beat' : null;
    if (parentUnit && layer.playMotifsVoiceManagers[parentUnit]) {
      const parentVM = layer.playMotifsVoiceManagers[parentUnit];
      const layerId = (layer && typeof layer.id === 'string' && layer.id.length > 0) ? layer.id : 'default';
      const parentHistory = parentVM.voiceHistoryByLayer.get(layerId);
      if (Array.isArray(parentHistory) && parentHistory.length > 0) {
        layer.playMotifsVoiceManagers[unit].voiceHistoryByLayer.set(layerId, parentHistory.map(h => Array.isArray(h) ? [...h] : []));
      }
    }
  }
  const VC = layer.playMotifsVoiceManagers[unit];
  const voiceCount = VC.getVoiceCount(unit);
  // scorer may come from active composer or cached on layer; validate before use
  const scorer = activeComposer?.VoiceLeadingScore || layer.VoiceLeadingScore;
  if (scorer && !V.optionalType(scorer.voiceRegistryScoreCandidate, 'function')) {
    const compName = activeComposer ? (activeComposer.constructor && activeComposer.constructor.name) || '<anonymous>' : '<none>';
    throw new Error(`playMotifs: composer ${compName} supplied invalid VoiceLeadingScore to layer ${layer && layer.id}`);
  }
  const runtimeProfile = (activeComposer && V.optionalType(activeComposer.runtimeProfile, 'object'))
    ? activeComposer.runtimeProfile
    : null;
  const runtimeVoiceOptions = (runtimeProfile && composerRuntimeProfileAdapter && V.optionalType(composerRuntimeProfileAdapter.getVoiceSelectionOptions, 'function'))
    ? playMotifsGetRuntimeVoiceOptions(runtimeProfile)
    : null;

  // Get phrase context from PhraseArcManager if available
  let phraseContext = null;
  if (FactoryManager && FactoryManager.sharedPhraseArcManager) {
    phraseContext = FactoryManager.sharedPhraseArcManager.getPhraseContext();
  }

  // Pass voicing options from composer for voice spacing constraints
  const voicingOptions = (activeComposer && typeof activeComposer.voicingOptions === 'object') ? activeComposer.voicingOptions : null;
  const selectionOptions = { phraseContext };
  if (voicingOptions) Object.assign(selectionOptions, voicingOptions);
  if (runtimeVoiceOptions) Object.assign(selectionOptions, runtimeVoiceOptions);
  if (runtimeProfile) selectionOptions.runtimeProfile = runtimeProfile;
  const rawPicks = VC.pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, selectionOptions);
  V.assertArray(rawPicks, 'rawPicks');
  const filteredPicks = [];
  const seenNotesThisUnit = new Set();

  for (let pi = 0; pi < rawPicks.length; pi++) {
    const note = Number(rawPicks[pi]);
    V.requireFinite(note, 'note');
    if (composerValidPCs.size > 0) {
      const pickPC = ((note % 12) + 12) % 12;
      if (!composerValidPCs.has(pickPC)) {
        throw new Error(`${unit}.playMotifs: VoiceManager returned invalid pick note ${note} (PC ${pickPC}) not in composer PCs [${Array.from(composerValidPCs).sort((a,b)=>a-b).join(',')}]`);
      }
    }
    if (seenNotesThisUnit.has(note)) continue;
    seenNotesThisUnit.add(note);
    filteredPicks.push({ note });
  }

  // Track which motif indices are being played this beat
  const playedGroupIndices = new Map();
  if (bucketEntry && bucketEntry.groupId && Number.isFinite(bucketEntry.seqIndex)) {
    playedGroupIndices.set(bucketEntry.groupId, [bucketEntry.seqIndex]);
  }

  playMotifsApplyCycleTransforms(layer, bucket, playedGroupIndices, cycleTracker, /** @type {any} */ (playMotifs).playMotifsCloneBucketEntry);

  return filteredPicks;
});

/**
 * Deep clone a bucket entry (preserve original, transform copy)
 */
/** @type {any} */ (playMotifs).playMotifsCloneBucketEntry = function(entry) {
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
  layer.playMotifsMotifCycleTracking = null;
  layer.playMotifsEmptyBucketCaptured = null;
  layer.playMotifsBucketCursors = null;
  layer.playMotifsWorkingOverrides = null;
  // Clear all hierarchical motif buckets to avoid stale notes across phrases
  layer.measureMotifs = null;
  layer.beatMotifs = [];
  layer.divMotifs = [];
  layer.subdivMotifs = [];
  layer.subsubdivMotifs = [];
  // Clear sibling voice tracking
  layer.playMotifsSiblingVoicePCs = null;
  layer.playMotifsSiblingVoiceLimits = null;
  // DO NOT reset playMotifsVoiceManagers here; they maintain voice leading continuity within a phrase
  // Sub-unit VMs are re-seeded from parent at each parent boundary automatically
};
