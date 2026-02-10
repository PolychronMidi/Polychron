// MotifValidators.js - validation helpers for motif generation

MotifValidators = {
  /**
   * Ensure that scaleNotes' pitch classes are compatible with a developer's note feed.
   * Throws a descriptive error on mismatch (keeps original MotifComposer error message for compatibility).
   * @param {Array} scaleNotes
   * @param {Object} developer
   */
  assertScaleMatchesDeveloper(scaleNotes, developer) {
    if (!developer || !Array.isArray(developer.notes) || developer.notes.length === 0) return;

    const expectedPCs = new Set();
    for (const noteName of developer.notes) {
      if (typeof noteName === 'string') {
        const pc = t.Note.chroma(noteName);
        if (typeof pc === 'number' && Number.isFinite(pc)) expectedPCs.add(((pc % 12) + 12) % 12);
      }
    }

    const scalePCs = new Set();
    for (const s of scaleNotes) {
      const pc = (typeof s.note === 'number') ? s.note : (typeof s === 'number' ? s : 0);
      scalePCs.add(((pc % 12) + 12) % 12);
    }

    for (const pc of scalePCs) {
      if (!expectedPCs.has(pc)) {
        throw new Error(`MotifComposer.generate: scaleNotes contains unexpected PC ${pc}. Developer.notes PCs: ${Array.from(expectedPCs).sort((a,b)=>a-b).join(',')}, scaleNotes PCs: ${Array.from(scalePCs).sort((a,b)=>a-b).join(',')}. Composer class: ${developer?.constructor?.name}. This indicates getNotes() is performing chromatic transposition/inversion instead of scale-degree permutation.`);
      }
    }
  }
};
