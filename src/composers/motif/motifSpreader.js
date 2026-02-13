// motifSpreader.js - centralize planning of motif groups across a measure
// Generates motif groups (min-max beats) and populates layer.beatMotifs accordingly

MotifSpreader = {
  spreadMeasure({ layer, measureStart, measureBeats, composer }) {
    try {
      if (!layer) throw new Error('MotifSpreader.spreadMeasure: no layer provided - fail-fast');
      if (!Number.isFinite(Number(measureBeats))) throw new Error(`MotifSpreader.spreadMeasure: invalid measureBeats=${measureBeats} - fail-fast`);
      const measureB = Number(measureBeats);
      let remaining = measureB;
      const groups = [];
      const min = 1; const max = 3;
      // Ensure group sizes are between min and max beats where possible
      if (remaining <= max) {
        // small measure: one group (can be 1 if measure is 1-beat)
        groups.push(remaining);
      } else {
        while (remaining > max) {
          let pick = ri(min, max);
          // avoid leaving a remainder smaller than min
          if (remaining - pick < min) {
            pick = remaining - min; // safe because remaining > max => remaining-min >= 6
            if (pick > max) pick = max;
          }
          groups.push(pick);
          remaining -= pick;
        }
        if (remaining > 0) groups.push(remaining);
      }

      let beatOffset = 0;
      if (typeof tpBeat === 'undefined' || !Number.isFinite(Number(tpBeat)) || Number(tpBeat) <= 0) {
        throw new Error(`MotifSpreader.spreadMeasure: invalid tpBeat=${tpBeat} - fail-fast`);
      }
      const beatLen = Number(tpBeat);

      // Add group's steps as candidates on every beat of the group's span;
      // Use LOCAL beat indices (0..numerator-1) to match how main.js indexes beats
      // beatIndex in playback is a local index within the measure, not an absolute tick-based index
      groups.forEach((gLen, groupIdx) => {
        const mcGroup = new MotifComposer({ useVoiceLeading: Boolean(composer && composer.VoiceLeadingScore) });
        const length = ri(min, m.max(1, m.min(8, gLen * min)));
        const motifGroup = mcGroup.generate({ length, fitToTotalTicks: true, totalTicks: gLen * beatLen, developFromComposer: composer, measureComposer: composer });
        if (!motifGroup || (!motifGroup.sequence && !motifGroup.events)) {
          throw new Error('MotifSpreader.spreadMeasure: MotifComposer.generate() returned invalid structure - fail-fast');
        }
        const seq = motifGroup.sequence || motifGroup.events;
        if (!Array.isArray(seq)) throw new Error('MotifSpreader.spreadMeasure: motif sequence is not an array - fail-fast');
        const totalEvents = seq.length;
        const groupId = `${measureStart}-${beatOffset}-${gLen}-${groupIdx}`;
        if (!layer.beatMotifs) throw new Error('MotifSpreader.spreadMeasure: layer.beatMotifs not initialized - fail-fast');

        // Extract valid pitch classes from composer for validation.
        // Use the HarmonicContext window scale when composer declares
        // timeVaryingScaleContext (safe, no side-effects). Otherwise use
        // the composer's declared `notes` array. Avoid calling
        // `composer.getNotes()` here because it may be stateful.
        const validPCs = new Set();
        if (composer) {
          const caps = (typeof composer.getCapabilities === 'function') ? composer.getCapabilities() : (composer.capabilities || {});

          if (caps && caps.timeVaryingScaleContext) {
            if (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function') {
              try {
                const hcScale = HarmonicContext.getField('scale');
                if (Array.isArray(hcScale) && hcScale.length > 0) {
                  for (const s of hcScale) {
                    const pc = (typeof s === 'number') ? ((s % 12) + 12) % 12 : t.Note.chroma(String(s));
                    if (Number.isFinite(pc)) validPCs.add(((pc % 12) + 12) % 12);
                  }
                }
              } catch { /* let fallback below handle it */ }
            }
          }

          if (validPCs.size === 0 && Array.isArray(composer.notes)) {
            for (const noteName of composer.notes) {
              if (typeof noteName === 'string') {
                const pc = t.Note.chroma(noteName);
                if (typeof pc === 'number' && Number.isFinite(pc)) validPCs.add(((pc % 12) + 12) % 12);
              } else if (typeof noteName === 'number') {
                validPCs.add(((noteName % 12) + 12) % 12);
              }
            }
          }
        }

        // ALWAYS create beat bucket entries for this group's beats, using LOCAL beat indices
        // playMotifs expects every beat to have a key in layer.beatMotifs
        for (let b = 0; b < gLen; b++) {
          const bKey = beatOffset + b;  // LOCAL beat index, not absolute
          // CLEAR previous bucket for this beat to prevent stale notes from old composer
          layer.beatMotifs[bKey] = [];

          // Populate with motif notes if generation succeeded; otherwise empty array is correct
          if (totalEvents > 0) {
            for (let i = 0; i < totalEvents; i++) {
              const evt = seq[i];
              const noteValue = Number(evt.note);
              // Clamp to valid MIDI range 0-127 before adding to bucket
              const clampedNote = modClamp(noteValue, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);

              // Fail-fast if bucket note has invalid pitch class
              if (validPCs.size > 0) {
                const notePC = ((clampedNote % 12) + 12) % 12;
                if (!validPCs.has(notePC)) {
                  throw new Error(`MotifSpreader: motif event ${i} produced note ${clampedNote} (PC ${notePC}) not in composer scale - valid PCs: ${Array.from(validPCs).sort((a,b)=>a-b).join(',')}`);
                }
              }

              layer.beatMotifs[bKey].push({ note: clampedNote, groupId, seqIndex: i, seqLen: totalEvents });
            }
          }
        }
        layer.activeMotif = motifGroup;
        beatOffset += gLen;
      });

    } catch (e) {
      throw e;
    }
  },

};
