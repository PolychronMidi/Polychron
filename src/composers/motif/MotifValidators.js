// MotifValidators.js - validation helpers for motif generation

MotifValidators = {
  _toPCSet(scaleLike, label = 'scale') {
    if (!Array.isArray(scaleLike) || scaleLike.length === 0) {
      throw new Error(`MotifValidators._toPCSet: ${label} must be a non-empty array`);
    }

    let pcs;
    if (typeof resolveScalePC === 'function') {
      pcs = resolveScalePC(scaleLike);
    } else {
      pcs = scaleLike.map((entry) => {
        if (typeof entry === 'number') return ((entry % 12) + 12) % 12;
        if (typeof entry === 'string') {
          const pc = t.Note.chroma(entry);
          if (!Number.isFinite(pc)) throw new Error(`MotifValidators._toPCSet: invalid note in ${label}: ${entry}`);
          return ((pc % 12) + 12) % 12;
        }
        throw new Error(`MotifValidators._toPCSet: unsupported entry in ${label}`);
      });
    }
    return new Set(pcs.map((pc) => ((pc % 12) + 12) % 12));
  },



  /**
   * Resolve capability contract from a composer/developer object.
   * @param {Object} developer
   * @returns {{preservesScale:boolean, mutatesPitchClasses:boolean, deterministic:boolean, notesReflectOutputSet:boolean, timeVaryingScaleContext:boolean}}
   */
  getCapabilities(developer) {
    const fallback = { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false, timeVaryingScaleContext: false };
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
        deterministic: developer.deterministic,
        notesReflectOutputSet: developer.notesReflectOutputSet,
        timeVaryingScaleContext: developer.timeVaryingScaleContext
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
   * @param {{ mode?: 'auto'|'strict-global'|'local-window', windowScale?: Array<string|number>|null, context?: Object }} [opts]
   */
  assertScaleMatchesDeveloper(scaleNotes, developer, opts = {}) {
    if (!Array.isArray(scaleNotes) || scaleNotes.length === 0) {
      throw new Error('MotifValidators.assertScaleMatchesDeveloper: scaleNotes must be a non-empty array');
    }
    if (!developer || typeof developer !== 'object') return;

    const caps = this.getCapabilities(developer);
    if (!caps.preservesScale) return;

    const modeInput = (opts && typeof opts.mode === 'string') ? opts.mode : 'auto';
    const validModes = ['auto', 'strict-global', 'local-window'];
    if (!validModes.includes(modeInput)) {
      throw new Error(`MotifValidators.assertScaleMatchesDeveloper: invalid mode "${modeInput}"`);
    }
    const mode = modeInput === 'auto'
      ? (caps.timeVaryingScaleContext ? 'local-window' : 'strict-global')
      : modeInput;

    let expectedPCs = null;
    if (mode === 'strict-global') {
      if (!caps.notesReflectOutputSet || !Array.isArray(developer.notes) || developer.notes.length === 0) return;
      expectedPCs = this._toPCSet(developer.notes, 'developer.notes');
    } else {
      const maybeWindowScale = opts && /** @type {any} */ (opts).windowScale;
      let windowScale = Array.isArray(maybeWindowScale) && maybeWindowScale.length > 0 ? /** @type {(string|number)[]} */ (maybeWindowScale) : null;
      if (!windowScale && typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function') {
        try {
          const hcScale = HarmonicContext.getField('scale');
          if (Array.isArray(hcScale) && hcScale.length > 0) windowScale = hcScale;
        } catch (err) {
          throw new Error(`MotifValidators.assertScaleMatchesDeveloper: failed to read HarmonicContext.scale — ${err && err.message ? err.message : String(err)}`);
        }
      }
      if (!windowScale && caps.notesReflectOutputSet && Array.isArray(developer.notes) && developer.notes.length > 0) {
        windowScale = developer.notes;
      }
      if (!windowScale) {
        const context = opts && opts.context ? JSON.stringify(opts.context) : '{}';
        throw new Error(`MotifValidators.assertScaleMatchesDeveloper: local-window mode requires window scale context (context=${context})`);
      }
      expectedPCs = this._toPCSet(windowScale, 'windowScale');
    }

    const scalePCs = new Set();
    for (const s of scaleNotes) {
      const pc = (typeof s.note === 'number') ? s.note : (typeof s === 'number' ? s : 0);
      scalePCs.add(((pc % 12) + 12) % 12);
    }

    for (const pc of scalePCs) {
      if (!expectedPCs.has(pc)) {
        throw new Error(`MotifComposer.generate: scaleNotes contains unexpected PC ${pc}. Expected PCs: ${Array.from(expectedPCs).sort((a,b)=>a-b).join(',')}, scaleNotes PCs: ${Array.from(scalePCs).sort((a,b)=>a-b).join(',')}. Mode=${mode}. Composer class: ${developer?.constructor?.name}. Composer capabilities: preservesScale=${caps.preservesScale}, mutatesPitchClasses=${caps.mutatesPitchClasses}, deterministic=${caps.deterministic}, notesReflectOutputSet=${caps.notesReflectOutputSet}, timeVaryingScaleContext=${caps.timeVaryingScaleContext}. This indicates getNotes() violated preservesScale contract.`);
      }
    }
  }
};
