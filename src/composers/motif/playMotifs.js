// playMotifs.js - Motif-driven note selection and transformation
// Handles beatMotifs bucket retrieval, cycle tracking, transformations, and voice coordination

playMotifs = /** @type {any} */ (function playMotifs(unit = 'subdiv', layer) {
  // Validate layer and beatMotifs bucket
  if (!layer || !layer.beatMotifs) {
    console.error(`${unit}.playMotifs missing layer or beatMotifs`);
    process.exit(1);
  }

  // Initialize per-beat cursor so we can cycle through bucket notes on each call
  if (typeof layer._lastBeatIndex !== 'number' || beatIndex < layer._lastBeatIndex) {
    // New measure or reset; clear cursors
    layer._beatBucketCursor = new Map();
  }
  layer._lastBeatIndex = beatIndex;
  if (!layer._beatBucketCursor) layer._beatBucketCursor = new Map();
  if (!layer._beatBucketCursor.has(beatIndex)) layer._beatBucketCursor.set(beatIndex, 0);

  const bucketIsArray = (layer && layer.beatMotifs && Array.isArray(layer.beatMotifs[beatIndex]));
  const bucket = bucketIsArray ? layer.beatMotifs[beatIndex] : null;

  // If there is no bucket (undefined), this is a critical bug - gating happens BEFORE playMotifs is called
  if (!bucketIsArray || !bucket) {
    console.error(`${unit}.playMotifs missing beatMotifs bucket for beatIndex ${beatIndex} - gating should have prevented this call`);
    process.exit(1);
  }

  // If we have an explicit bucket but it's empty, this is a critical generation bug
  if (!bucket.length) {
    console.error(`${unit}.playMotifs empty beatMotifs bucket at beatIndex ${beatIndex} - generation failed to populate`);
    process.exit(1);
  }

  // Initialize beatNoteHistory tracking per beat
  const beatNoteHistory = (layer && layer._beatNoteHistory instanceof Map) ? layer._beatNoteHistory : new Map();
  if (!layer._beatNoteHistory || layer._beatNoteHistory !== beatNoteHistory) layer._beatNoteHistory = beatNoteHistory;
  if (!beatNoteHistory.has(beatIndex)) {
    beatNoteHistory.clear();
    beatNoteHistory.set(beatIndex, new Set());
  }
  const beatNoteSet = beatNoteHistory.get(beatIndex);

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
  const cursor = layer._beatBucketCursor.get(beatIndex) || 0;
  const bucketEntry = bucket[cursor % bucket.length];
  layer._beatBucketCursor.set(beatIndex, cursor + 1);
  if (!bucketEntry || typeof bucketEntry.note === 'undefined') {
    throw new Error(`${unit}.playMotifs: invalid bucket entry at cursor=${cursor}`);
  }

  // Extract valid PCs from active composer
  const composerValidPCs = new Set();
  if (typeof composer === 'object' && composer !== null && Array.isArray(composer.notes)) {
    for (const noteName of composer.notes) {
      if (typeof noteName === 'string') {
        const pc = t.Note.chroma(noteName);
        if (typeof pc === 'number' && Number.isFinite(pc)) {
          composerValidPCs.add(((pc % 12) + 12) % 12);
        }
      }
    }
  }

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
  const voiceCount = VC.getVoiceCount();
  const scorer = layer.measureComposer?.VoiceLeadingScore || layer.VoiceLeadingScore;

  // Get phrase context from PhraseArcManager if available
  let phraseContext = null;
  if (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager) {
    phraseContext = ComposerFactory.sharedPhraseArcManager.getPhraseContext();
  }

  // Pass voicing options from composer for voice spacing constraints
  const voicingOptions = layer.measureComposer?.voicingOptions || {};
  const rawPicks = VC.pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, { phraseContext, ...voicingOptions });
  const picks = rawPicks.map(note => ({ note }));

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

  // Filter out duplicate notes already played this beat
  const filteredPicks = picks.filter(s => {
    if (beatNoteSet && beatNoteSet.has(s.note)) return false;
    if (beatNoteSet) beatNoteSet.add(s.note);
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
  layer._beatNoteHistory = null;
  layer._motifCycleTracking = null;
  layer._emptyBucketCaptured = null;
  // DO NOT reset _voiceManager here; it maintains voice leading continuity within a phrase
};
