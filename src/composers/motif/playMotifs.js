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

  // ---------------------------------------------------------------------------
  // Resolve target bucket based on unit type
  // ---------------------------------------------------------------------------
  const plannedDivsPerBeat = (layer && Number.isFinite(layer._plannedDivsPerBeat)) ? Number(layer._plannedDivsPerBeat) : Number(divsPerBeat);
  const absBeatIdx = Number.isFinite(Number(beatIndex)) ? Number(beatIndex) : 0;
  const absDivOff = Number.isFinite(Number(divIndex)) ? Number(divIndex) : 0;
  const absDivIdx = m.max(0, absBeatIdx * plannedDivsPerBeat + absDivOff);
  const absSubOff = Number.isFinite(Number(subdivIndex)) ? Number(subdivIndex) : 0;
  const absSubIdx = absDivIdx * (Number.isFinite(Number(subdivsPerDiv)) ? Number(subdivsPerDiv) : 1) + absSubOff;
  const absSSbOff = Number.isFinite(Number(subsubdivIndex)) ? Number(subsubdivIndex) : 0;
  const absSSbIdx = absSubIdx * (Number.isFinite(Number(subsubsPerSub)) ? Number(subsubsPerSub) : 1) + absSSbOff;

  let targetIndex, bucket, bucketLabel;
  switch (unit) {
    case 'beat':
      targetIndex = absBeatIdx;
      bucket = layer.beatMotifs && layer.beatMotifs[targetIndex];
      bucketLabel = 'beatMotifs';
      // Fallback to divMotifs[first-div-of-beat] for backward compat
      if (!Array.isArray(bucket) || bucket.length === 0) {
        targetIndex = absBeatIdx * plannedDivsPerBeat;
        bucket = layer.divMotifs && layer.divMotifs[targetIndex];
        bucketLabel = 'divMotifs(fallback)';
      }
      break;
    case 'subdiv':
      targetIndex = absSubIdx;
      bucket = layer.subdivMotifs && layer.subdivMotifs[targetIndex];
      bucketLabel = 'subdivMotifs';
      // Fallback to divMotifs
      if (!Array.isArray(bucket) || bucket.length === 0) {
        targetIndex = absDivIdx;
        bucket = layer.divMotifs && layer.divMotifs[targetIndex];
        bucketLabel = 'divMotifs(fallback)';
      }
      break;
    case 'subsubdiv':
      targetIndex = absSSbIdx;
      bucket = layer.subsubdivMotifs && layer.subsubdivMotifs[targetIndex];
      bucketLabel = 'subsubdivMotifs';
      // Fallback to subdivMotifs then divMotifs
      if (!Array.isArray(bucket) || bucket.length === 0) {
        targetIndex = absSubIdx;
        bucket = layer.subdivMotifs && layer.subdivMotifs[targetIndex];
        bucketLabel = 'subdivMotifs(fallback)';
      }
      if (!Array.isArray(bucket) || bucket.length === 0) {
        targetIndex = absDivIdx;
        bucket = layer.divMotifs && layer.divMotifs[targetIndex];
        bucketLabel = 'divMotifs(fallback)';
      }
      break;
    default: // 'div' and any unrecognized unit
      targetIndex = absDivIdx;
      bucket = layer.divMotifs && layer.divMotifs[targetIndex];
      bucketLabel = 'divMotifs';
      break;
  }

  if (!Array.isArray(bucket) || bucket.length === 0) {
    throw new Error(`${unit}.playMotifs: empty ${bucketLabel} bucket at index ${targetIndex} - fail-fast`);
  }

  // ---------------------------------------------------------------------------
  // Per-bucket cursor: cycle through bucket notes on repeated calls
  // ---------------------------------------------------------------------------
  if (!layer._bucketCursors) layer._bucketCursors = {};
  if (!layer._bucketCursors[unit]) layer._bucketCursors[unit] = new Map();
  const cursorMap = layer._bucketCursors[unit];

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

  if (!LM || typeof LM.getComposerFor !== 'function') {
    throw new Error(`${unit}.playMotifs: LayerManager.getComposerFor not available`);
  }
  if (typeof LM.activeLayer !== 'string' || LM.activeLayer.length === 0) {
    throw new Error(`${unit}.playMotifs: LayerManager.activeLayer is not set`);
  }
  const activeLayer = LM.layers[LM.activeLayer];
  if (!activeLayer || typeof activeLayer !== 'object') {
    throw new Error(`${unit}.playMotifs: active layer "${LM.activeLayer}" not found`);
  }
  const activeComposer = LM.getComposerFor(LM.activeLayer);

  if (typeof scaleNormalization === 'undefined' || !scaleNormalization || typeof scaleNormalization.collectComposerValidPCs !== 'function') {
    throw new Error(`${unit}.playMotifs: scaleNormalization.collectComposerValidPCs() not available`);
  }

  // Extract valid PCs from active composer
  const composerValidPCs = scaleNormalization.collectComposerValidPCs(activeComposer, {
    preferTimeVaryingContext: true,
    label: `${unit}.playMotifs`
  });

  // Get candidate notes from bucket entry and select via centralized voice coordination
  let candidateNotes = (() => {
    const note = Number(bucketEntry.note);
    // Validate MIDI range and clamp if needed
    if (!Number.isFinite(note) || note < OCTAVE.min * 12 - 1 || note > OCTAVE.max * 12 - 1) {
      return [modClamp(note, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1)];
    }
    return [note];
  })();

  // If we have fewer candidates than typical voice count, expand pool using scale-aware neighbors
  if (candidateNotes.length < 3) {
    const minNote = m.max(0, OCTAVE.min * 12 - 1);
    const maxNote = OCTAVE.max * 12 - 1;
    candidateNotes = CandidateExpansion.expandScaleAware(candidateNotes, composerValidPCs, minNote, maxNote, 6);
  }

  // CRITICAL: Filter out stale notes from older composers that don't belong in current composer
  if (composerValidPCs.size > 0) {
    const beforeLen = candidateNotes.length;
    candidateNotes = candidateNotes.filter(note => {
      const pc = ((note % 12) + 12) % 12;
      return composerValidPCs.has(pc);
    });
    if (candidateNotes.length === 0 && beforeLen > 0) {
      throw new Error(`${unit}.playMotifs: All bucket notes were filtered out - bucket contains stale notes from previous composer (beforeLen=${beforeLen}, composerValidPCs=[${Array.from(composerValidPCs).sort((a,b)=>a-b).join(',')}])`);
    }
  }

  if (typeof HarmonicContext !== 'undefined') {
    const scale = HarmonicContext.getField('scale');
    if (Array.isArray(scale) && scale.length > 0) {
      const filtered = candidateNotes.filter(note => HarmonicContext.isNoteInScale(note));
      if (filtered.length > 0) {
        // Only use HarmonicContext filter if it preserves composer's PCs
        const filteredPCs = new Set(filtered.map(n => ((n % 12) + 12) % 12));
        let allValid = true;
        for (const pc of filteredPCs) {
          if (composerValidPCs.size > 0 && !composerValidPCs.has(pc)) {
            allValid = false;
            break;
          }
        }
        if (allValid) {
          candidateNotes = filtered;
        }
        // If HarmonicContext filter would introduce invalid PCs, skip it
      }
    }
  }

  // Preserve voice Manager instance per layer to maintain voice history across beats within a phrase
  if (!layer._voiceManager) layer._voiceManager = new VoiceManager();
  const VC = layer._voiceManager;
  const voiceCount = VC.getVoiceCount(unit);
  const scorer = activeComposer?.VoiceLeadingScore || layer.VoiceLeadingScore;
  const runtimeProfile = (activeComposer && activeComposer.runtimeProfile && typeof activeComposer.runtimeProfile === 'object')
    ? activeComposer.runtimeProfile
    : null;
  const runtimeVoiceOptions = (runtimeProfile && typeof ComposerRuntimeProfileAdapter !== 'undefined' && ComposerRuntimeProfileAdapter && typeof ComposerRuntimeProfileAdapter.getVoiceSelectionOptions === 'function')
    ? ComposerRuntimeProfileAdapter.getVoiceSelectionOptions(runtimeProfile)
    : {};

  // Get phrase context from PhraseArcManager if available
  let phraseContext = null;
  if (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager) {
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

  // Update cycle tracking and apply transformations when cycles complete
  for (const [groupId, indices] of playedGroupIndices) {
    const tracking = cycleTracker.get(groupId);
    if (!tracking) continue;

    for (const idx of indices) tracking.playedIndices.add(idx);

    // Check if cycle completed (all indices 0..seqLen-1 have been played)
    if (tracking.playedIndices.size >= tracking.seqLen) {
      tracking.cycleCount++;
      tracking.playedIndices.clear();

      // Apply transformations to cloned copies of group entries (preserve originals in bucket)
      const groupEntries = bucket.filter(e => e.groupId === groupId).map(e => /** @type {any} */ (playMotifs)._cloneBucketEntry(e));
      if (groupEntries.length > 0) {
        if (rf() < 0.05) {
          // No transformation - use entries as-is
        } else {
          try {
            // Select and apply random transformations using MotifTransforms
            const transforms = MotifTransforms.selectRandom(groupEntries.length);
            MotifTransforms.applyAll(groupEntries, transforms);
          } catch (e) {
            throw new Error(`playMotifs: transformation failed for groupId ${groupId}: ${e && e.message ? e.message : e}`);
          }
        }

        // Apply transformed entries back to bucket (update in-place)
        for (let i = 0; i < groupEntries.length; i++) {
          const orig = bucket.filter(e => e.groupId === groupId)[i];
          if (orig) orig.note = groupEntries[i].note;
        }
      }
    }
  }

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
  // Clear all hierarchical motif buckets to avoid stale notes across phrases
  layer.measureMotifs = null;
  layer.beatMotifs = [];
  layer.divMotifs = [];
  layer.subdivMotifs = [];
  layer.subsubdivMotifs = [];
  // Clear sibling voice tracking
  layer._siblingVoicePCs = null;
  layer._siblingVoiceLimits = null;
  // DO NOT reset _voiceManager here; it maintains voice leading continuity within a phrase
};
