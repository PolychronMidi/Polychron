scaleNormalization = {
  createMidiFitter(scale, label = 'scaleNormalization.createMidiFitter') {
    if (typeof resolveScalePC !== 'function') {
      throw new Error(`${label}: resolveScalePC() not available`);
    }
    if (typeof modClamp !== 'function') {
      throw new Error(`${label}: modClamp() not available`);
    }
    if (typeof transposeByDegree !== 'function') {
      throw new Error(`${label}: transposeByDegree() not available`);
    }

    const scalePC = resolveScalePC(scale);
    const allowedMidi = [];
    for (let midi = 0; midi <= 127; midi++) {
      if (scalePC.includes(modClamp(midi, 0, 11))) allowedMidi.push(midi);
    }
    if (allowedMidi.length === 0) {
      throw new Error(`${label}: effective scale produced no in-range MIDI candidates`);
    }

    const nearestAllowedMidi = (raw) => {
      let best = allowedMidi[0];
      let bestDist = m.abs(Number(raw) - best);
      for (let i = 1; i < allowedMidi.length; i++) {
        const cand = allowedMidi[i];
        const d = m.abs(Number(raw) - cand);
        if (d < bestDist) {
          best = cand;
          bestDist = d;
        }
      }
      return best;
    };

    const fitMidi = (midiVal) => {
      if (!Number.isFinite(Number(midiVal))) throw new Error(`${label}: non-finite midi value during normalization`);
      let out = modClamp(Number(midiVal), 0, 127);
      let outPC = modClamp(out, 0, 11);
      if (!scalePC.includes(outPC)) {
        const quantRaw = transposeByDegree(Number(midiVal), scale, 0, { quantize: true, clampToMidi: false });
        if (!Number.isFinite(Number(quantRaw))) {
          throw new Error(`${label}: quantization produced non-finite midi`);
        }
        const quantWrapped = modClamp(Number(quantRaw), 0, MIDI_MAX_VALUE);
        const quantPC = modClamp(quantWrapped, 0, 11);
        if (scalePC.includes(quantPC)) {
          out = quantWrapped;
          outPC = quantPC;
        } else {
          out = nearestAllowedMidi(Number(quantRaw));
          outPC = modClamp(out, 0, 11);
        }
      }
      if (!scalePC.includes(outPC)) {
        out = nearestAllowedMidi(Number(midiVal));
        outPC = modClamp(out, 0, 11);
      }
      if (!scalePC.includes(outPC)) throw new Error(`${label}: failed to normalize note ${midiVal} to effective scale`);
      return m.round(out);
    };

    return { scalePC, fitMidi };
  },

  collectComposerValidPCs(composer, opts = {}) {
    const pcs = new Set();
    if (!composer) return pcs;

    const preferTimeVaryingContext = opts.preferTimeVaryingContext !== false;
    const label = (typeof opts.label === 'string' && opts.label.length > 0)
      ? opts.label
      : 'scaleNormalization.collectComposerValidPCs';

    const addPitchClass = (val) => {
      if (!Number.isFinite(Number(val))) return;
      pcs.add(((Number(val) % 12) + 12) % 12);
    };

    const addFromEntries = (entries) => {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (typeof entry === 'string') {
          if (!t || !t.Note || typeof t.Note.chroma !== 'function') {
            throw new Error(`${label}: tonal Note.chroma() not available`);
          }
          const pc = t.Note.chroma(entry);
          if (Number.isFinite(pc)) addPitchClass(pc);
        } else {
          addPitchClass(entry);
        }
      }
    };

    const caps = (composer && typeof composer.getCapabilities === 'function')
      ? composer.getCapabilities()
      : (composer && composer.capabilities ? composer.capabilities : {});

    const shouldUseWindowScale = preferTimeVaryingContext
      && caps
      && caps.timeVaryingScaleContext === true
      && HarmonicContext
      && HarmonicContext.getField;
    if (shouldUseWindowScale) {
      const windowScale = HarmonicContext.getField('scale');
      addFromEntries(windowScale);
    }

    if (pcs.size === 0) {
      addFromEntries(composer.notes);
    }

    return pcs;
  }
};
