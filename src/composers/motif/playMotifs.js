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
  let candidateNotes = bucket.map(s => {
    const note = Number(s.note);
    // Validate MIDI range and clamp if needed
    if (!Number.isFinite(note) || note < OCTAVE.min * 12 - 1 || note > OCTAVE.max * 12 - 1) {
      return modClamp(note, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
    }
    return note;
  });

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

  const picks = VC.pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, { phraseContext }).map(note => ({ note }));

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
            // Apply pure permutations to groupEntries array (no MotifChain dependency)
            const len = groupEntries.length;

            // Collect transformations to apply
            const transforms = [];
            if (rf() > 0.5) transforms.push('reverse');
            if (rf() > 0.5) transforms.push({ type: 'rotate', amount: ri(-len, len) });
            if (rf() > 0.5) transforms.push({ type: 'invert', pivot: 0 });
            if (rf() > 0.5) transforms.push('augmentDuration');

            // Ensure at least one transformation
            if (transforms.length === 0) {
              transforms.push(['reverse', { type: 'rotate', amount: 1 }, { type: 'invert', pivot: 0 }, 'augmentDuration'][ri(0, 3)]);
            }

            // Apply permutation transformations to groupEntries
            for (const transform of transforms) {
              if (transform === 'reverse') {
                // Reverse array in-place
                for (let i = 0; i < Math.floor(len / 2); i++) {
                  const j = len - 1 - i;
                  const temp = groupEntries[i];
                  groupEntries[i] = groupEntries[j];
                  groupEntries[j] = temp;
                }
              } else if (typeof transform === 'object' && transform !== null && (transform).type === 'rotate') {
                // Rotate array: shift positions
                const shift = (((transform).amount % len) + len) % len;
                if (shift > 0) {
                  const rotated = groupEntries.slice(-shift).concat(groupEntries.slice(0, len - shift));
                  for (let i = 0; i < len; i++) groupEntries[i] = rotated[i];
                }
              } else if (typeof transform === 'object' && transform !== null && (transform).type === 'invert') {
                // Invert (mirror) around pivot
                const pivotIdx = (transform).pivot ?? 0;
                const inverted = new Array(len);
                for (let i = 0; i < len; i++) {
                  const srcIdx = ((2 * pivotIdx - i) % len + len) % len;
                  inverted[i] = groupEntries[srcIdx];
                }
                for (let i = 0; i < len; i++) groupEntries[i] = inverted[i];
              } else if (transform === 'augmentDuration') {
                // Scale durations (doesn't change note order)
                const factor = rf(1.1, 2.0);
                groupEntries.forEach(e => {
                  if (e.duration && typeof e.duration === 'number') {
                    e.duration = Math.max(1, Math.round(e.duration * factor));
                  }
                });
              }
            }
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
