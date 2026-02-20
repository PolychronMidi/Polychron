// playMotifsBuildCandidateNotes.js - candidate pool generation for playMotifs

playMotifsBuildCandidateNotes = function playMotifsBuildCandidateNotes(unit, resolvedNote, composerValidPCs) {
  const minMidi = m.max(0, OCTAVE.min * 12);
  const maxMidi = m.min(127, OCTAVE.max * 12 - 1);

  let candidateNotes = (() => {
    const note = Number(resolvedNote);
    if (!Number.isFinite(note) || note < minMidi || note > maxMidi) {
      return [modClamp(note, minMidi, maxMidi)];
    }
    return [note];
  })();

  if (candidateNotes.length < 3) {
    const minNote = minMidi;
    const maxNote = maxMidi;
    candidateNotes = CandidateExpansion.expandScaleAware(candidateNotes, composerValidPCs, minNote, maxNote, 6, unit);
  }

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

  if (HarmonicContext) {
    const scale = HarmonicContext.getField('scale');
    if (Array.isArray(scale) && scale.length > 0) {
      const filtered = candidateNotes.filter(note => HarmonicContext.isNoteInScale(note));
      if (filtered.length > 0) {
        const filteredPCs = new Set(filtered.map(n => ((n % 12) + 12) % 12));
        let allValid = true;
        for (const pc of filteredPCs) {
          if (composerValidPCs.size > 0 && !composerValidPCs.has(pc)) {
            allValid = false;
            break;
          }
        }
        if (allValid) candidateNotes = filtered;
      }
    }
  }

  return candidateNotes;
};
