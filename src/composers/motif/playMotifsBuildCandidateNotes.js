// playMotifsBuildCandidateNotes.js - candidate pool generation for playMotifs

const playMotifsBuildCandidateNotesMinMidi = m.max(0, OCTAVE.min * 12);
const playMotifsBuildCandidateNotesMaxMidi = m.min(127, OCTAVE.max * 12 - 1);

playMotifsBuildCandidateNotes = function playMotifsBuildCandidateNotes(unit, resolvedNote, composerValidPCs) {
  const minMidi = playMotifsBuildCandidateNotesMinMidi;
  const maxMidi = playMotifsBuildCandidateNotesMaxMidi;

  const note = Number(resolvedNote);
  let candidateNotes;
  if (!Number.isFinite(note) || note < minMidi || note > maxMidi) {
    candidateNotes = [modClamp(note, minMidi, maxMidi)];
  } else {
    candidateNotes = [note];
  }

  if (candidateNotes.length < 3) {
    const minNote = minMidi;
    const maxNote = maxMidi;
    candidateNotes = candidateExpansion.expandScaleAware(candidateNotes, composerValidPCs, minNote, maxNote, 6, unit);
  }

  if (composerValidPCs.size > 0) {
    const beforeLen = candidateNotes.length;
    const filteredNotes = [];
    for (let index = 0; index < candidateNotes.length; index++) {
      const candidateNote = candidateNotes[index];
      const pc = ((candidateNote % 12) + 12) % 12;
      if (composerValidPCs.has(pc)) filteredNotes.push(candidateNote);
    }
    candidateNotes = filteredNotes;
    if (candidateNotes.length === 0 && beforeLen > 0) {
      throw new Error(`${unit}.playMotifs: All bucket notes were filtered out - bucket contains stale notes from previous composer (beforeLen=${beforeLen}, composerValidPCs=[${Array.from(composerValidPCs).sort((a,b)=>a-b).join(',')}])`);
    }
  }

  if (harmonicContext) {
    const scale = harmonicContext.getField('scale');
    if (Array.isArray(scale) && scale.length > 0) {
      const filtered = [];
      for (let index = 0; index < candidateNotes.length; index++) {
        const candidateNote = candidateNotes[index];
        if (harmonicContext.isNoteInScale(candidateNote)) filtered.push(candidateNote);
      }
      if (filtered.length > 0) {
        candidateNotes = filtered;
      }
    }
  }

  return candidateNotes;
};
