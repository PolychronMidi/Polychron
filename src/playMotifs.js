// playMotifs.js - Motif-driven note selection and transformation
// Handles beatMotifs bucket retrieval, cycle tracking, transformations, and voice coordination

playMotifs = function(unit = 'subdiv', layer) {
  // Validate layer and beatMotifs bucket
  if (!layer || !layer.beatMotifs) {
    console.warn(`${unit}.playMotifs: missing layer or beatMotifs`);
    return [];
  }

  const bucketIsArray = (layer && layer.beatMotifs && Array.isArray(layer.beatMotifs[beatIndex]));
  const bucket = bucketIsArray ? layer.beatMotifs[beatIndex] : [];

  // If there is no bucket (undefined), this is not normal silence; play gating in playNotes handles that
  if (!bucketIsArray) {
    console.warn(`${unit}.playMotifs: missing beatMotifs bucket for beatIndex ${beatIndex}`);
    return [];
  }

  // If we have an explicit bucket but it's empty, capture context once and warn (possible bug)
  if (!bucket.length) {
    // One-time diagnostic marker: record that an explicit empty bucket was observed
    try {
      if (!layer._emptyBucketCaptured) {
        layer._emptyBucketCaptured = true;
      }
    } catch (__) { /* defensive */ }

    console.warn(`${unit}.playMotifs: empty beatMotifs bucket`);
    return [];
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

  const voiceCount = globalVoiceCoordinator.getVoiceCount();
  const scorer = layer.measureComposer?.VoiceLeadingScore || layer.VoiceLeadingScore;

  // Get phrase context from PhraseArcManager if available
  let phraseContext = null;
  if (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager) {
    phraseContext = ComposerFactory.sharedPhraseArcManager.getPhraseContext();
  }

  const picks = globalVoiceCoordinator.pickNotesForBeat(layer, candidateNotes, voiceCount, scorer, { phraseContext }).map(note => ({ note }));

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

      // Apply transformations to this groupId's notes in the bucket
      const groupEntries = bucket.filter(e => e.groupId === groupId);
      if (groupEntries.length > 0) {
        // Choose 1-3 random transformations
        const transformations = [];
        if (rf() > 0.5) transformations.push('invert');
        if (rf() > 0.5) transformations.push('shuffle');
        if (rf() > 0.5) transformations.push('octaveShift');

        // Ensure at least one transformation
        if (transformations.length === 0) transformations.push(['invert', 'shuffle', 'octaveShift'][ri(0, 2)]);

        // Apply transformations with MIDI range validation (0-127)
        if (transformations.includes('invert')) {
          // Invert around average pitch of the group
          const avgPitch = groupEntries.reduce((sum, e) => sum + e.note, 0) / groupEntries.length;
          groupEntries.forEach(e => {
            const inverted = Math.round(2 * avgPitch - e.note);
            e.note = modClamp(inverted, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
          });
        }

        if (transformations.includes('shuffle')) {
          // Shuffle note assignments while preserving seqIndex order
          const notes = groupEntries.map(e => e.note);
          for (let i = notes.length - 1; i > 0; i--) {
            const j = ri(0, i);
            [notes[i], notes[j]] = [notes[j], notes[i]];
          }
          groupEntries.forEach((e, i) => { e.note = notes[i]; });
        }

        if (transformations.includes('octaveShift')) {
          // Shift by +/-1 octave with bounds checking
          const shift = (rf() > 0.5 ? 12 : -12);
          groupEntries.forEach(e => {
            const shifted = e.note + shift;
            e.note = modClamp(shifted, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
          });
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
};
