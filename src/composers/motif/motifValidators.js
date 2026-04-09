// motifValidators.js - validation helpers for motif generation
const V = validator.create('motifValidators');

motifValidators = {
  motifValidatorsToPCSet(scaleLike, label = 'scale') {
    V.assertArray(scaleLike, label);
    if (scaleLike.length === 0) {
      throw new Error(`motifValidators.motifValidatorsToPCSet: ${label} must be a non-empty array`);
    }

    const pcs = resolveScalePC(scaleLike);
    return new Set(pcs.map((pc) => ((pc % 12) + 12) % 12));
  },



  /**
   * Resolve capability contract from a composer/developer object.
   * @param {Object} developer
   * @returns {{preservesScale:boolean, mutatesPitchClasses:boolean, deterministic:boolean, notesReflectOutputSet:boolean, timeVaryingScaleContext:boolean}}
   */
  getCapabilities(developer) {
    const fallback = { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false, timeVaryingScaleContext: false };
    if (!V.optionalType(developer, 'object')) return fallback;

    let caps = null;
    if (V.optionalType(developer.getCapabilities, 'function', null) !== null) {
      caps = developer.getCapabilities();
    } else if (developer.capabilities && V.optionalType(developer.capabilities, 'object', null) !== null) {
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

    const merged = Object.assign({}, fallback, caps);
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
    V.assertArray(scaleNotes, 'scaleNotes');
    if (scaleNotes.length === 0) {
      throw new Error('motifValidators: scaleNotes must be a non-empty array');
    }
    if (!V.optionalType(developer, 'object')) throw new Error('motifValidators: developer must be object');

    const caps = this.getCapabilities(developer);
    if (!caps.preservesScale) return;

    const modeInput = (opts && V.optionalType(opts.mode, 'string', null) !== null) ? opts.mode : 'auto';
    const validModes = ['auto', 'strict-global', 'local-window'];
    V.assertInSet(modeInput, new Set(validModes), 'mode');
    const mode = modeInput === 'auto'
      ? (caps.timeVaryingScaleContext ? 'local-window' : 'strict-global')
      : modeInput;

    let expectedPCs = null;
    if (mode === 'strict-global') {
      const notesIsArr = (() => { try { V.assertArray(developer.notes, 'developer.notes'); return true; } catch (_) { return false; } })();
      if (!caps.notesReflectOutputSet || !notesIsArr || developer.notes.length === 0) return;
      expectedPCs = this.motifValidatorsToPCSet(developer.notes, 'developer.notes');
    } else {
      const maybeWindowScale = opts && /** @type {any} */ (opts).windowScale;
      let windowScale; { const maybeIsArr = (() => { try { V.assertArray(maybeWindowScale, 'maybeWindowScale'); return true; } catch (_) { return false; } })(); windowScale = maybeIsArr && maybeWindowScale.length > 0 ? /** @type {(string|number)[]} */ (maybeWindowScale) : null; }
      if (!windowScale && harmonicContext) {
        try {
          const hcScale = harmonicContext.getField('scale');
          const hcScaleIsArr = (() => { try { V.assertArray(hcScale, 'hcScale'); return true; } catch (_) { return false; } })();
        if (hcScaleIsArr && hcScale.length > 0) windowScale = hcScale;
        } catch (err) {
          throw new Error(`motifValidators.assertScaleMatchesDeveloper: failed to read harmonicContext.scale - ${err && err.message ? err.message : String(err)}`);
        }
      }
      const devNotesIsArr = (() => { try { V.assertArray(developer.notes, 'developer.notes'); return true; } catch (_) { return false; } })();
      if (!windowScale && caps.notesReflectOutputSet && devNotesIsArr && developer.notes.length > 0) {
        windowScale = developer.notes;
      }
      if (!windowScale) {
        const context = opts && opts.context ? JSON.stringify(opts.context) : '{}';
        throw new Error(`motifValidators: local-window mode requires window scale context (context=${context})`);
      }
      expectedPCs = this.motifValidatorsToPCSet(windowScale, 'windowScale');
    }

    const scalePCs = new Set();
    for (const s of scaleNotes) {
      const pc = V.optionalFinite(s.note, null) !== null ? s.note : (V.optionalFinite(s, null) !== null ? s : 0);
      scalePCs.add(((pc % 12) + 12) % 12);
    }

    for (const pc of scalePCs) {
      if (!expectedPCs.has(pc)) {
        throw new Error(`MotifComposer.generate: scaleNotes contains unexpected PC ${pc}. Expected PCs: ${Array.from(expectedPCs).sort((a,b)=>a-b).join(',')}, scaleNotes PCs: ${Array.from(scalePCs).sort((a,b)=>a-b).join(',')}. Mode=${mode}. Composer class: ${developer?.constructor?.name}. Composer capabilities: preservesScale=${caps.preservesScale}, mutatesPitchClasses=${caps.mutatesPitchClasses}, deterministic=${caps.deterministic}, notesReflectOutputSet=${caps.notesReflectOutputSet}, timeVaryingScaleContext=${caps.timeVaryingScaleContext}. This indicates getNotes() violated preservesScale contract.`);
      }
    }
  }
};
