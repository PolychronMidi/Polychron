// melodicDevelopmentVoicingIntent.js — Extracted helper for MelodicDevelopmentComposer voicing intent scoring.

/**
 * Compute candidate weights for voicing intent based on base/developed note
 * membership and current development phase.
 *
 * @param {Array<number|{note:number}>} candidateNotes - Available MIDI notes
 * @param {Array<number|{note:number}>} lastBaseNotes - Base notes from last getNotes()
 * @param {Array<number|{note:number}>} lastDevelopedNotes - Developed notes from last getNotes()
 * @param {number} developmentBias - Development bias weight (0-1)
 * @param {number} intensity - Current scaled intensity (0-1)
 * @param {number} currentPhase - Current development phase (0-3)
 * @returns {{ candidateWeights: { [note: number]: number } } | null}
 */
melodicDevelopmentVoicingIntent = function melodicDevelopmentVoicingIntent(
  candidateNotes, lastBaseNotes, lastDevelopedNotes, developmentBias, intensity, currentPhase
) {
  if (!Array.isArray(candidateNotes) || candidateNotes.length === 0) return null;
  if (lastBaseNotes.length === 0 || lastDevelopedNotes.length === 0) return null;

  const baseWeight = 1.0;
  const transformWeight = developmentBias * intensity;

  // Extract note values from base and developed arrays
  const baseNotesSet = new Set();
  for (const item of lastBaseNotes) {
    const n = typeof item === 'number' ? item : (item && typeof item === 'object' && typeof item.note === 'number' ? item.note : null);
    if (typeof n === 'number' && Number.isFinite(n)) baseNotesSet.add(n);
  }

  const developedNotesSet = new Set();
  for (const item of lastDevelopedNotes) {
    const n = typeof item === 'number' ? item : (item && typeof item === 'object' && typeof item.note === 'number' ? item.note : null);
    if (typeof n === 'number' && Number.isFinite(n)) developedNotesSet.add(n);
  }

  // Phase-based weight scaling
  const phaseScale = currentPhase === 0 ? 0.8 :
                    currentPhase === 1 ? 1.2 :
                    currentPhase === 2 ? 1.5 :
                    currentPhase === 3 ? 1.0 : 1.0;

  // Assign weights based on category
  /** @type {{ [note: number]: number }} */
  const candidateWeights = {};
  for (const candidate of candidateNotes) {
    let note;
    if (typeof candidate === 'number') {
      note = candidate;
    } else {
      const candidateObj = /** @type {any} */ (candidate);
      if (candidateObj && typeof candidateObj === 'object' && typeof candidateObj.note === 'number') {
        note = candidateObj.note;
      } else {
        throw new Error('melodicDevelopmentVoicingIntent: candidate must be a number or {note:number}');
      }
    }

    if (!Number.isFinite(note)) {
      throw new Error('melodicDevelopmentVoicingIntent: candidate note must be finite');
    }

    const isBase = baseNotesSet.has(note);
    const isDeveloped = developedNotesSet.has(note);

    if (isBase && isDeveloped) {
      candidateWeights[note] = baseWeight + transformWeight * 0.5;
    } else if (isDeveloped) {
      candidateWeights[note] = baseWeight * 0.3 + transformWeight * phaseScale;
    } else if (isBase) {
      candidateWeights[note] = baseWeight;
    } else {
      candidateWeights[note] = baseWeight * 0.2;
    }

    candidateWeights[note] = m.max(0, candidateWeights[note]);
  }

  return { candidateWeights };
};
