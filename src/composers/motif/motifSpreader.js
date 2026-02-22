// motifSpreader.js — hierarchical motif planning across unit levels
// Generates motif groups at each level of the musical hierarchy
// (measure → beat → div → subdiv → subsubdiv) with parent‑child derivation.
// Measure-level master motifs create coherence; child levels derive variations
// via MotifChain transforms + IntervalComposer subsets.

MotifSpreader = {
  /**
   * Plan measure-level motif and derive beat-level buckets.
   * Called once per measure from MotifManager.planMeasure().
   */
  spreadMeasure({ layer, beats, composer, profile }) {
    if (!layer) throw new Error('MotifSpreader.spreadMeasure: no layer');
    if (!Number.isFinite(Number(beats)) || Number(beats) <= 0) throw new Error('MotifSpreader.spreadMeasure: invalid beats');
    if (!composer) throw new Error('MotifSpreader.spreadMeasure: no composer');

    const mc = new MotifComposer({ useVoiceLeading: Boolean(composer.VoiceLeadingScore) });
    const length = m.max(2, m.round(Number(beats) * rf(1.5, 2.5)));
    const measureMotif = mc.generate({ length, developFromComposer: composer, measureComposer: composer });
    if (!measureMotif || !measureMotif.sequence) throw new Error('MotifSpreader.spreadMeasure: motif generation failed');

    layer.measureMotifs = { motif: measureMotif, groupId: `msr-${measureCount}` };
    layer._plannedBeats = Number(beats);

    // Init sibling voice tracking for the new measure
    layer._siblingVoicePCs = { beat: new Set(), div: new Set(), subdiv: new Set(), subsubdiv: new Set() };
    layer._siblingVoiceLimits = {
      beat: rw(BEAT_SIBLING_VOICES.min, BEAT_SIBLING_VOICES.max, BEAT_SIBLING_VOICES.weights),
      div: rw(DIV_SIBLING_VOICES.min, DIV_SIBLING_VOICES.max, DIV_SIBLING_VOICES.weights),
      subdiv: rw(SUBDIV_SIBLING_VOICES.min, SUBDIV_SIBLING_VOICES.max, SUBDIV_SIBLING_VOICES.weights),
      subsubdiv: rw(SUBSUBDIV_SIBLING_VOICES.min, SUBSUBDIV_SIBLING_VOICES.max, SUBSUBDIV_SIBLING_VOICES.weights)
    };

    // Derive beat-level buckets from the measure motif
    layer.beatMotifs = [];
    this._deriveChildBuckets({ layer, parentMotif: measureMotif, count: Number(beats), bucketKey: 'beatMotifs', unit: 'beat', profile });
  },

  /**
   * Spread across divisions. Core DIV-only planner (called at beat boundary).
   * Accepts optional parentBucket for parent-derived coherence.
   */
  spreadDivs({ layer, divsPerBeat: planDivsPerBeat, beats = 1, composer, parentBucket = null }) {
    if (!layer) throw new Error('MotifSpreader.spreadDivs: no layer provided - fail-fast');
    if (!Number.isFinite(Number(planDivsPerBeat)) || Number(planDivsPerBeat) <= 0) throw new Error('MotifSpreader.spreadDivs: planDivsPerBeat must be > 0 - fail-fast');
    if (!Number.isFinite(Number(beats)) || Number(beats) <= 0) throw new Error(`MotifSpreader.spreadDivs: invalid beats=${beats} - fail-fast`);

    const divCount = Number(planDivsPerBeat) * Number(beats);
    layer._plannedDivsPerBeat = Number(planDivsPerBeat);
    layer._plannedBeats = Number(beats);
    layer._plannedDivCount = divCount;

    // Reset div-level sibling voices for this beat cycle
    if (layer._siblingVoicePCs) layer._siblingVoicePCs.div = new Set();

    // If parent bucket available, create a proxy composer for parent-derived generation
    const pb = Array.isArray(parentBucket) ? parentBucket : [];
    const developComposer = (pb.length > 0) ? {
      getNotes: () => pb.map(e => ({ note: e.note })),
      VoiceLeadingScore: composer && composer.VoiceLeadingScore,
      getCapabilities: () => ({ preservesScale: false, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false, timeVaryingScaleContext: true })
    } : composer;

    const minDiv = Math.max(1, Math.floor(Number(planDivsPerBeat) * rf(0.1, 0.5)));
    const maxDiv = Math.max(1, Math.floor(Number(planDivsPerBeat) * rf(0.5, 1.5)));
    let remainingDivs = divCount;
    const groupsDiv = [];
    if (remainingDivs <= maxDiv) {
      groupsDiv.push(remainingDivs);
    } else {
      while (remainingDivs > maxDiv) {
        let pick = ri(minDiv, maxDiv);
        if (remainingDivs - pick < minDiv) { pick = remainingDivs - minDiv; if (pick > maxDiv) pick = maxDiv; }
        groupsDiv.push(pick);
        remainingDivs -= pick;
      }
      if (remainingDivs > 0) groupsDiv.push(remainingDivs);
    }

    if (!layer.divMotifs) layer.divMotifs = [];
    for (let i = 0; i < divCount; i++) layer.divMotifs[i] = [];

    let divOffset = 0;
    groupsDiv.forEach((gDivLen, groupIdx) => {
      const mcGroup = new MotifComposer({ useVoiceLeading: Boolean(composer && composer.VoiceLeadingScore) });
      const length = Math.max(1, m.round(gDivLen * ri(1, 3)));
      const motifGroup = mcGroup.generate({ length, developFromComposer: developComposer, measureComposer: composer });
      if (!motifGroup || (!motifGroup.sequence && !motifGroup.events)) throw new Error('MotifSpreader.spreadDivs: MotifComposer.generate() returned invalid structure - fail-fast');
      const seq = motifGroup.sequence || motifGroup.events;
      if (!Array.isArray(seq)) throw new Error('MotifSpreader.spreadDivs: motif sequence is not an array - fail-fast');
      const totalEvents = Math.max(1, seq.length);
      const groupStart = divOffset;
      const groupEnd = Math.min(divCount - 1, divOffset + gDivLen - 1);
      const span = groupEnd - groupStart + 1;
      const groupId = `div${divOffset}-${gDivLen}-${groupIdx}`;

      for (let d = 0; d < span; d++) {
        const targetDiv = groupStart + d;
        const startEvt = Math.floor(d * totalEvents / span);
        const endEvt = Math.floor((d + 1) * totalEvents / span);
        if (startEvt < endEvt) {
          for (let ei = startEvt; ei < endEvt; ei++) {
            const evt = seq[ei];
            const noteValue = Number(evt.note);
            if (!Number.isFinite(noteValue)) throw new Error(`MotifSpreader: motif event ${ei} produced non-finite note value`);
            layer.divMotifs[targetDiv].push({ note: noteValue, groupId, seqIndex: ei, seqLen: totalEvents });
          }
        } else {
          const fallbackIdx = m.min(totalEvents - 1, startEvt);
          const evt = seq[fallbackIdx];
          const noteValue = Number(evt.note);
          if (!Number.isFinite(noteValue)) throw new Error(`MotifSpreader: motif event ${fallbackIdx} produced non-finite note value`);
          layer.divMotifs[targetDiv].push({ note: noteValue, groupId, seqIndex: fallbackIdx, seqLen: totalEvents });
        }
      }
      layer.activeMotif = motifGroup;
      divOffset += gDivLen;
    });

    for (let i = 0; i < divCount; i++) {
      if (!Array.isArray(layer.divMotifs[i]) || layer.divMotifs[i].length === 0) throw new Error(`MotifSpreader.spreadDivs: divMotifs[${i}] not populated - fail-fast`);
    }
  },

  /**
   * Plan sub-unit motifs (subdiv or subsubdiv) derived from parent bucket.
   * Called at div/subdiv boundaries from MotifManager.
   */
  spreadSubunits({ layer, unit, parentIndex, count, bucketKey, parentBucketKey, profile }) {
    if (!layer) throw new Error(`MotifSpreader.spreadSubunits(${unit}): no layer`);
    if (!Number.isFinite(Number(count)) || Number(count) <= 0) return;
    const parentBuckets = layer[parentBucketKey];
    if (!Array.isArray(parentBuckets) || !Array.isArray(parentBuckets[parentIndex])) {
      throw new Error(`MotifSpreader.spreadSubunits(${unit}): missing parent bucket at ${parentBucketKey}[${parentIndex}]`);
    }
    // Reset sibling voices for this sub-unit cycle
    if (layer._siblingVoicePCs && layer._siblingVoicePCs[unit]) layer._siblingVoicePCs[unit] = new Set();

    const parentBucket = parentBuckets[parentIndex];
    const parentSeq = parentBucket.map(e => ({ note: e.note, duration: 1 }));
    const parentMotif = new Motif(parentSeq);
    const baseIndex = parentIndex * Number(count);
    if (!layer[bucketKey]) layer[bucketKey] = [];
    this._deriveChildBuckets({ layer, parentMotif, count: Number(count), bucketKey, unit, profile, baseIndex });
  },

  /**
   * Generic derivation of child buckets from a parent motif.
   * Uses MotifChain for transforms and IntervalComposer for degree subsets.
   */
  _deriveChildBuckets({ layer, parentMotif, count, bucketKey, unit, profile, baseIndex = 0 }) {
    const seq = parentMotif.sequence || parentMotif.events;
    if (!Array.isArray(seq) || seq.length === 0) throw new Error(`MotifSpreader._deriveChildBuckets(${unit}): empty parent sequence`);

    for (let i = 0; i < count; i++) {
      const idx = baseIndex + i;
      MotifChain.clearTransforms();
      MotifChain.setActive(parentMotif);
      // Separate ranges: rotate uses small position offsets; transpose uses wider pitch shifts
      if (rf() > 0.15) MotifChain.mutate({ transposeRange: [-m.max(3, count * 2), m.max(3, count * 2)], rotateRange: [-m.max(1, count), m.max(1, count)] });
      let derived;
      try { derived = MotifChain.apply(); } catch { derived = parentMotif; }
      const dSeq = derived.sequence || derived.events;
      if (!Array.isArray(dSeq) || dSeq.length === 0) { layer[bucketKey][idx] = [{ note: Number(seq[0].note), groupId: `${unit}${idx}`, seqIndex: 0, seqLen: 1 }]; continue; }

      let intervals;
      try { intervals = IntervalComposer.selectIntervals(dSeq.length, { density: profile.intervalDensity, style: profile.style, minNotes: 1 }); }
      catch { intervals = [0]; }

      const groupId = `${unit}${idx}`;
      const entries = [];
      for (let j = 0; j < intervals.length; j++) {
        const evt = dSeq[intervals[j]];
        if (evt && Number.isFinite(Number(evt.note))) entries.push({ note: Number(evt.note), groupId, seqIndex: j, seqLen: intervals.length });
      }
      if (entries.length === 0) entries.push({ note: Number(seq[0].note), groupId, seqIndex: 0, seqLen: 1 });
      layer[bucketKey][idx] = entries;
    }

    // Sibling palette enforcement at planning time: constrain total unique PCs
    // across all child buckets to the sibling limit for this unit level.
    // Each child can still freely pick from the constrained palette at runtime.
    const sibLimit = layer._siblingVoiceLimits && layer._siblingVoiceLimits[unit];
    if (typeof sibLimit === 'number' && sibLimit > 0) {
      // Collect PC frequency across all generated buckets
      const pcFreq = new Map();
      for (let i = 0; i < count; i++) {
        const bkt = layer[bucketKey][baseIndex + i];
        if (!Array.isArray(bkt)) continue;
        for (const e of bkt) {
          const pc = ((Number(e.note) % 12) + 12) % 12;
          pcFreq.set(pc, (pcFreq.get(pc) || 0) + 1);
        }
      }
      if (pcFreq.size > sibLimit) {
        // Keep the most-used PCs up to sibLimit
        const ranked = [...pcFreq.entries()].sort((a, b) => b[1] - a[1]);
        const keepPCs = new Set(ranked.slice(0, sibLimit).map(r => r[0]));
        // Remap out-of-palette notes to nearest kept PC
        for (let i = 0; i < count; i++) {
          const bkt = layer[bucketKey][baseIndex + i];
          if (!Array.isArray(bkt)) continue;
          for (const e of bkt) {
            const pc = ((Number(e.note) % 12) + 12) % 12;
            if (!keepPCs.has(pc)) {
              // Find nearest kept PC and shift note
              let bestDist = 12;
              let bestPC = pc;
              for (const kpc of keepPCs) {
                const d = m.min(m.abs(kpc - pc), 12 - m.abs(kpc - pc));
                if (d < bestDist) { bestDist = d; bestPC = kpc; }
              }
              const shift = ((bestPC - pc + 18) % 12) - 6;
              e.note = Number(e.note) + shift;
            }
          }
        }
      }
    }
  },
};
