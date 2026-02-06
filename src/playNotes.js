// playNotes.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to the naked global `noteCascade` when available.

playNotes = function(unit = 'subdiv', opts = {}) {
  const {
    enableStutter = false,
    playProb = 0,
    stutterProb = 0
  } = opts || {};

  // Compute on and sustain
  const on = unitStart + (tpUnit * rv(rf(.2), [-.1, .07], .3));
  const shortSustain = rv(rf(Math.max(tpUnit * .5, tpUnit / unitsPerParent), (tpUnit * (.3 + rf() * .7))), [.1, .2], .1, [-.05, -.1]);
  const longSustain = rv(rf(tpUnit * .8, (tpParent * (.3 + rf() * .7))), [.1, .3], .1, [-.05, -0.1]);
  const useShort = subdivsPerMinute > ri(400, 650);
  const sustain = (useShort ? shortSustain : longSustain) * rv(rf(.8, 1.3));
  velocity = rl(velocity,-3,3,95,105);
  const binVel = rv(velocity * rf(.4, .9));

  let scheduled = 0;
  crossModulateRhythms();
  const layer = LM.layers[LM.activeLayer];
  try {
    // Gate play invocation with playProb and crossModulation
    if (typeof playProb === 'number' && !( playProb > rf() ) && crossModulation < rv(rf(1.8, 2.2), [-.2, -.3], .05)) {
      return trackRhythm(unit, layer, false);
    }

    if (!layer || !layer.beatMotifs) { console.warn(`${unit}.playNotes: missing layer or beatMotifs`); return trackRhythm(unit, layer, false); }
    const bucketIsArray = (layer && layer.beatMotifs && Array.isArray(layer.beatMotifs[beatIndex]));
    const bucket = bucketIsArray ? layer.beatMotifs[beatIndex] : [];

    // If there is no bucket (undefined), this is not normal silence; play gating above via probOn and crossModulation handles that
    if (!bucketIsArray) {
      console.warn(`${unit}.playNotes: missing beatMotifs bucket for beatIndex ${beatIndex}`);
      return trackRhythm(unit, layer, false);
    }

    // If we have an explicit bucket but it's empty, capture context once and warn (possible bug)
    if (!bucket.length) {
      // One-time diagnostic marker: record that an explicit empty bucket was observed
      try {
        if (!layer._emptyBucketCaptured) {
          layer._emptyBucketCaptured = true;
        }
      } catch (__) { /* defensive */ }

      console.warn(`${unit}.playNotes: empty beatMotifs bucket`);
      return trackRhythm(unit, layer, false);
    }

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

    for (let pi = 0; pi < picks.length; pi++) {
      const s = picks[pi];
      if (!s || typeof s.note === 'undefined') console.warn(`${unit}.playNotes: invalid note object in motif picks`, s);

      if (beatNoteSet && beatNoteSet.has(s.note)) { continue; }
      if (beatNoteSet) beatNoteSet.add(s.note);

      // Source channels
      const activeSourceChannels = source.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let sci = 0; sci < activeSourceChannels.length; sci++) {
        const sourceCH = activeSourceChannels[sci];
        const isPrimary = sourceCH === cCH1;
        const onTick = isPrimary ? on + rv(tpUnit * rf(1/9), [-.1, .1], .3) : on + rv(tpUnit * rf(1/3), [-.1, .1], .3);
        const onVel = isPrimary ? velocity * rf(.95, 1.15) : binVel * rf(.75, 1.03);
        p(c, { tick: onTick, type: 'on', vals: [sourceCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? 1 : rv(rf(.92, 1.03)));
        p(c, { tick: offTick, vals: [sourceCH, s.note] }); scheduled++;

          // Schedule stutter if requested — stutter can be controlled by stutterProb or enableStutter boolean
          const stutterEnabledByProb = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow = (typeof stutterEnabledByProb === 'boolean') ? stutterEnabledByProb : (enableStutter && rf() > 0.5);
          if (shouldStutterNow) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'source', channel: sourceCH, note: s.note, on, sustain, velocity, binVel, isPrimary });
            } catch (e) { console.warn(`${unit}.playNotes: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }

      // Reflection channels
      const activeReflectionChannels = reflection.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let rci = 0; rci < activeReflectionChannels.length; rci++) {
        const reflectionCH = activeReflectionChannels[rci];
        const isPrimary = reflectionCH === cCH2;
        const onTick = isPrimary ? on + rv(tpUnit * rf(.2), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
        const onVel = isPrimary ? velocity * rf(.7, 1.2) : binVel * rf(.55, 1.1);
        p(c, { tick: onTick, type: 'on', vals: [reflectionCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? rf(.7, 1.2) : rv(rf(.65, 1.3)));
        p(c, { tick: offTick, vals: [reflectionCH, s.note] }); scheduled++;

          const stutterEnabledByProb_ref = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow_ref = (typeof stutterEnabledByProb_ref === 'boolean') ? stutterEnabledByProb_ref : (enableStutter && rf() > 0.5);
          if (shouldStutterNow_ref) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'reflection', channel: reflectionCH, note: s.note, on, sustain, velocity, binVel, isPrimary });
            } catch (e) { console.warn(`${unit}.playNotes: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }

      // Bass channels
      if (rf() < clamp(.75 * bpmRatio3, .2, .7)) {
        const activeBassChannels = bass.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
        for (let bci = 0; bci < activeBassChannels.length; bci++) {
          const bassCH = activeBassChannels[bci];
          const isPrimary = bassCH === cCH3;
          const bassNote = modClamp(s.note, m.max(0, OCTAVE.min * 12 - 1), 59);
          const onTick = isPrimary ? on + rv(tpUnit * rf(.1), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
          const onVel = isPrimary ? velocity * rf(1.15, 1.5) : binVel * rf(1.85, 2.5);
          p(c, { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] }); scheduled++;
          const offTick = on + sustain * (isPrimary ? rf(1.1, 3) : rv(rf(.8, 3.5)));
          p(c, { tick: offTick, vals: [bassCH, bassNote] }); scheduled++;

          if (enableStutter && rf() > 0.5) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'bass', channel: bassCH, note: bassNote, on, sustain, velocity, binVel, isPrimary });
            } catch (e) { console.warn(`${unit}.playNotes: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }
      }
    }
    trackRhythm(unit, layer, true);
  } catch (e) {
    console.warn(`${unit}.playNotes: non-fatal error while playing notes:`, e && e.stack ? e.stack : e);
    trackRhythm(unit, layer, false);
  }

  return scheduled;
};
