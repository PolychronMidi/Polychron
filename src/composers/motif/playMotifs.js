// playMotifs.js - Motif-driven note selection and transformation
// Handles beatMotifs bucket retrieval, cycle tracking, transformations, and voice coordination

playMotifs = /** @type {any} */ (function playMotifs(unit = 'subdiv', layer) {
  // Validate layer and beatMotifs bucket
  if (!layer || !layer.beatMotifs) {
    console.error(`${unit}.playMotifs missing layer or beatMotifs`);
    process.exit(1);
  }

  // Cache picks per beatIndex to avoid re-selecting from bucket 40+ times per beat
  if (!layer._beatPicksCache) layer._beatPicksCache = { beatIndex: -1, picks: [] };
  const cache = layer._beatPicksCache;

  // If we already have picks for this beatIndex, return them (same beat, different timing unit)
  if (cache.beatIndex === beatIndex && cache.picks && cache.picks.length > 0) {
    return cache.picks;
  }

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

  // Get candidate notes from bucket and select via centralized voice coordination
  const candidateNotes = bucket.map(s => {
    const note = Number(s.note);
    // Validate MIDI range and clamp if needed
    if (!Number.isFinite(note) || note < OCTAVE.min * 12 - 1 || note > OCTAVE.max * 12 - 1) {
      return modClamp(note, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
    }
    return note;
  });
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

  const picks = VC.pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, { phraseContext }).map(note => ({ note }));

  // Track which motif indices are being played this beat
  const playedGroupIndices = new Map();
  for (let pi = 0; pi < picks.length; pi++) {
    const pickNote = picks[pi].note;
    const matchingEntry = bucket.find(e => e.note === pickNote);
    if (matchingEntry && matchingEntry.groupId && Number.isFinite(matchingEntry.seqIndex)) {
      if (!playedGroupIndices.has(matchingEntry.groupId)) playedGroupIndices.set(matchingEntry.groupId, []);
      playedGroupIndices.get(matchingEntry.groupId).push(matchingEntry.seqIndex);
    }
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
            // Create Motif from group notes
            if (typeof Motif !== 'undefined' && typeof MotifChain !== 'undefined') {
              const notes = groupEntries.map(e => e.note);
              const motif = new Motif(notes, { defaultDuration: 1 });
              MotifChain.setActive(motif);

              // Queue transformations probabilistically
              if (rf() > 0.5) MotifChain.addTransform('invert');
              if (rf() > 0.5) MotifChain.addTransform('transpose', ri(-12, 12));
              if (rf() > 0.5) MotifChain.addTransform('reverse');
              if (rf() > 0.5) MotifChain.addTransform('augment');

              // Ensure at least one transformation queued
              if (MotifChain.getTransforms().length === 0) {
                MotifChain.addTransform(['invert', 'transpose', 'reverse', 'augment'][ri(0, 3)]);
              }

              // Apply the chain and extract transformed notes
              const transformedMotif = MotifChain.apply();
              const transformedNotes = transformedMotif.applyToNotes(notes);

              // Update groupEntries with transformed notes, clamped to MIDI range
              transformedNotes.forEach((note, i) => {
                if (groupEntries[i]) {
                  groupEntries[i].note = modClamp(note, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
                }
              });

              // Clear transforms for next cycle
              MotifChain.clearTransforms();
            } else {
              // Fallback: simple transformations if MotifChain unavailable
              const avgPitch = groupEntries.reduce((sum, e) => sum + e.note, 0) / groupEntries.length;
              groupEntries.forEach(e => {
                const inverted = Math.round(2 * avgPitch - e.note);
                e.note = modClamp(inverted, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
              });
            }
          } catch (e) {
            console.warn(`playMotifs: MotifChain transformation failed, skipping for groupId ${groupId}:`, e && e.message ? e.message : e);
          }
        }

        // Apply transformed notes back to bucket (update in-place)
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

  // Cache the picks for this beatIndex so subsequent unit calls within the same beat reuse them
  cache.beatIndex = beatIndex;
  cache.picks = filteredPicks;

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
