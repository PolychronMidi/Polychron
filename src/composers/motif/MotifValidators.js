// MotifValidators.js - validation helpers for motif generation

MotifValidators = {
  /**
   * Resolve capability contract from a composer/developer object.
   * @param {Object} developer
   * @returns {{preservesScale:boolean, mutatesPitchClasses:boolean, deterministic:boolean, notesReflectOutputSet:boolean}}
   */
  getCapabilities(developer) {
    const fallback = { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false };
    if (!developer || typeof developer !== 'object') return fallback;

    let caps = null;
    if (typeof developer.getCapabilities === 'function') {
      caps = developer.getCapabilities();
    } else if (developer.capabilities && typeof developer.capabilities === 'object') {
      caps = developer.capabilities;
    } else {
      caps = {
        preservesScale: developer.preservesScale,
        mutatesPitchClasses: developer.mutatesPitchClasses,
        deterministic: developer.deterministic
      };
    }

    const merged = Object.assign({}, fallback, caps || {});
    if (typeof assertComposerCapabilities !== 'function') throw new Error('MotifValidators.getCapabilities: assertComposerCapabilities() not available');
    return assertComposerCapabilities(merged);
  },

  /**
   * Ensure that scaleNotes' pitch classes are compatible with a developer's note feed.
   * Throws a descriptive error on mismatch (keeps original MotifComposer error message for compatibility).
   * @param {Array} scaleNotes
   * @param {Object} developer
   */
  assertScaleMatchesDeveloper(scaleNotes, developer) {
    if (!developer || !Array.isArray(developer.notes) || developer.notes.length === 0) return;
    const caps = this.getCapabilities(developer);
    if (!caps.preservesScale || !caps.notesReflectOutputSet) return;

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
        throw new Error(`MotifComposer.generate: scaleNotes contains unexpected PC ${pc}. Developer.notes PCs: ${Array.from(expectedPCs).sort((a,b)=>a-b).join(',')}, scaleNotes PCs: ${Array.from(scalePCs).sort((a,b)=>a-b).join(',')}. Composer class: ${developer?.constructor?.name}. Composer capabilities: preservesScale=${caps.preservesScale}, mutatesPitchClasses=${caps.mutatesPitchClasses}, deterministic=${caps.deterministic}, notesReflectOutputSet=${caps.notesReflectOutputSet}. This indicates getNotes() violated preservesScale contract.`);
      }
    }
  }
};
