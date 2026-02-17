// motifSpreader.js - centralize planning of motif groups across a measure
// Generates motif groups (division-sized) and populates layer.divMotifs accordingly

MotifSpreader = {
  // Spread across divisions only. Groups are sized in divisions and are
  // placed into `divMotifs` buckets (one bucket per division). This API is
  // division‑first — the caller provides the total divisions the planner must
  // populate (`divsPerBeat`) and this function partitions and fills those buckets.
  spreadDivs({ layer, divsPerBeat: planDivsPerBeat, beats = 1, composer }) {
    try {
      if (!layer) throw new Error('MotifSpreader.spreadDivs: no layer provided - fail-fast');

      // Validate required globals/params (division-only logic)
      if (!Number.isFinite(Number(planDivsPerBeat)) || Number(planDivsPerBeat) <= 0) {
        throw new Error('MotifSpreader.spreadDivs: planDivsPerBeat must be > 0 - fail-fast');
      }
      if (!Number.isFinite(Number(beats)) || Number(beats) <= 0) {
        throw new Error(`MotifSpreader.spreadDivs: invalid beats=${beats} - fail-fast`);
      }




      // compute total divisions and store planner metadata on the layer (DIVS-only)
      const divCount = Number(planDivsPerBeat) * Number(beats);
      layer._plannedDivsPerBeat = Number(planDivsPerBeat);
      layer._plannedBeats = Number(beats);
      layer._plannedDivCount = divCount;

      // Group sizes (in divisions) are computed relative to a single beat
      // (so groups remain beat-local), and groups are partitioned across the
      // full DIV resolution the caller requested (DIVS only — no measure math).
      const minDiv = Math.max(1, Math.floor(Number(planDivsPerBeat) * 0.1));
      const maxDiv = Math.max(1, Math.floor(Number(planDivsPerBeat) * 0.3));

      // Build division-sized groups that sum to the total divisions requested
      // by the caller (`divsPerBeat`).
      let remainingDivs = divCount;
      const groupsDiv = [];
      if (remainingDivs <= maxDiv) {
        groupsDiv.push(remainingDivs);
      } else {
        while (remainingDivs > maxDiv) {
          let pick = ri(minDiv, maxDiv);
          // avoid leaving a remainder smaller than minDiv
          if (remainingDivs - pick < minDiv) {
            pick = remainingDivs - minDiv;
            if (pick > maxDiv) pick = maxDiv;
          }
          groupsDiv.push(pick);
          remainingDivs -= pick;
        }
        if (remainingDivs > 0) groupsDiv.push(remainingDivs);
      }

      // Ensure division-level buckets are present and cleared for the full scope
      if (!layer.divMotifs) layer.divMotifs = [];
      for (let i = 0; i < divCount; i++) layer.divMotifs[i] = [];

      // Populate groups across the measure's division buckets. Each group
      // occupies `gDivLen` consecutive division buckets; distribute the group's
      // events evenly across those division buckets so subunits see distinct
      // content (no wholesale seeding of the same event into every div).
      let divOffset = 0; // absolute division-local offset within measure
      groupsDiv.forEach((gDivLen, groupIdx) => {
        // Create motif for this (small) group — length scaled to division size
        const mcGroup = new MotifComposer({ useVoiceLeading: Boolean(composer && composer.VoiceLeadingScore) });
        const length = Math.max(1, m.round(gDivLen * ri(1, 3)));
        const motifGroup = mcGroup.generate({ length, developFromComposer: composer, measureComposer: composer });
        if (!motifGroup || (!motifGroup.sequence && !motifGroup.events)) {
          throw new Error('MotifSpreader.spreadDivs: MotifComposer.generate() returned invalid structure - fail-fast');
        }
        const seq = motifGroup.sequence || motifGroup.events;
        if (!Array.isArray(seq)) throw new Error('MotifSpreader.spreadDivs: motif sequence is not an array - fail-fast');
        const totalEvents = Math.max(1, seq.length);

        // Group occupies divisions [divOffset .. divOffset+gDivLen-1]
        const groupStart = divOffset;
        const groupEnd = Math.min(divCount - 1, divOffset + gDivLen - 1);
        const span = groupEnd - groupStart + 1;
        const groupId = `div${divOffset}-${gDivLen}-${groupIdx}`;

        // Distribute sequence events across the group's divisions evenly
        for (let d = 0; d < span; d++) {
          const targetDiv = groupStart + d;
          // Calculate event slice for this division (even partition)
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
            // Ensure at least one event per division: duplicate nearest event
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

      // Post-condition: ensure every output bucket contains at least one
      // motif entry for the DIV-only scope. Fail-fast if any bucket is missing/empty.
      for (let i = 0; i < divCount; i++) {
        if (!Array.isArray(layer.divMotifs[i]) || layer.divMotifs[i].length === 0) {
          throw new Error(`MotifSpreader.spreadDivs: divMotifs[${i}] not populated - fail-fast`);
        }
      }

    } catch (e) {
      throw e;
    }
  },

};
