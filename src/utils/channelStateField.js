// channelStateField: living substrate tracking per-channel per-layer
// param state (pan/fade/fx/velocity) with writer-tag lineage. Field
// (not event) model -- observers sample and derive variance/correlation.
// O(1) per write, ~240 slots total; CIM uses writer-tag distribution
// for dominance + contention locality.

channelStateField = (() => {
  const V = validator.create('channelStateField');
  // Depth 16 preserves recent contention; depth 48 hid weaker writers.
  const HISTORY_DEPTH = 16;
  const LAYERS = ['L1', 'L2'];

  // Track only CCs that fluidsynth + SGM audibly respond to.
  const CC_TO_PARAM = {
    1:  'mod',        // modulation wheel -- GM1 universal
    7:  'fade',       // channel volume -- GM1 universal
    10: 'pan',        // pan -- GM1 universal
    11: 'fx',         // expression -- GM1 universal
    71: 'resonance',  // filter resonance -- SF2 modulator, SGM supports
    74: 'filter',     // filter cutoff -- SF2 universal
    91: 'reverb',     // reverb send -- fluidsynth built-in reverb
    93: 'chorus',     // chorus send -- fluidsynth built-in chorus
  };

  const field = { L1: new Map(), L2: new Map() };

  const _slot = (layer, channel, param) => {
    const f = field[layer];
    if (!f) return null;
    let ch = f.get(channel);
    if (!ch) { ch = new Map(); f.set(channel, ch); }
    let slot = ch.get(param);
    if (!slot) {
      slot = { value: null, writer: null, lastBeat: -1, writeCount: 0, history: [] };
      ch.set(param, slot);
    }
    return slot;
  };

  const _layer = () => LM.activeLayer || 'L1';
  const _beat = () => beatCount;

  // Mutate a slot. The substrate records value + writer + beat and keeps
  // a bounded history for field-stat computation.
  const write = (channel, param, value, writer) => {
    V.requireDefined(channel, 'channel');
    V.assertNonEmptyString(param, 'param');
    V.requireFinite(value, 'value');
    V.assertNonEmptyString(writer, 'writer');
    const slot = _slot(_layer(), channel, param);
    if (!slot) return;
    slot.value = value;
    slot.writer = writer;
    slot.lastBeat = _beat();
    slot.writeCount++;
    slot.history.push({ value, writer, beat: slot.lastBeat });
    if (slot.history.length > HISTORY_DEPTH) slot.history.shift();
  };

  // Convenience for the MIDI CC path: decodes CC number to param name
  // and forwards to write(). Unmapped CCs are silently skipped.
  const observeControl = (channel, ccNumber, value, writer) => {
    const param = CC_TO_PARAM[ccNumber];
    if (!param) return;
    write(channel, param, value, writer);
  };

  const read = (channel, param, opts = {}) => {
    const layer = opts.layer || _layer();
    const f = field[layer];
    if (!f) return null;
    const ch = f.get(channel);
    return ch ? (ch.get(param) ?? null) : null;
  };

  // Infer recent slot direction so writers can cooperate instead of antagonize.
  const recentTrend = (channel, param, opts = {}) => {
    const slot = read(channel, param, opts);
    if (!slot) return 0;
    const h = V.optionalType(slot.history, 'array', []);
    if (h.length < 2) return 0;
    const lookback = m.min(4, h.length);
    let net = 0;
    // Non-finite values fall back to NaN, whose comparisons are always
    // false -- they contribute 0 to net without needing an explicit guard.
    for (let i = h.length - lookback + 1; i < h.length; i++) {
      const prev = V.optionalFinite(Number(h[i - 1].value), NaN);
      const cur = V.optionalFinite(Number(h[i].value), NaN);
      if (cur > prev) net++;
      else if (cur < prev) net--;
    }
    if (net > 0) return 1;
    if (net < 0) return -1;
    return 0;
  };

  // Frozen copy of the whole field for forensic snapshots.
  const getFieldSnapshot = () => {
    const out = { L1: {}, L2: {} };
    for (const layer of LAYERS) {
      for (const [channel, ch] of field[layer].entries()) {
        out[layer][channel] = {};
        for (const [param, slot] of ch.entries()) {
          out[layer][channel][param] = {
            value: slot.value,
            writer: slot.writer,
            lastBeat: slot.lastBeat,
            writeCount: slot.writeCount,
            history: slot.history.slice()
          };
        }
      }
    }
    return out;
  };

  // Per-slot stats: variance, writer count, directional cooperation, contention.
  const _computeSlotStats = (slot) => {
    const h = slot.history;
    if (h.length < 2) return { variance: 0, writerCount: h.length, cooperation: 0, contention: 0 };
    const vals = h.map((e) => (typeof e.value === 'number' ? e.value : 0));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
    const writers = new Set(h.map((e) => e.writer));
    const contention = writers.size / h.length;
    let aligned = 0, opposed = 0;
    for (let i = 2; i < h.length; i++) {
      const d1 = vals[i - 1] - vals[i - 2];
      const d2 = vals[i] - vals[i - 1];
      if (d1 * d2 > 0) aligned++;
      else if (d1 * d2 < 0) opposed++;
    }
    const signed = aligned + opposed;
    const cooperation = signed > 0 ? (aligned - opposed) / signed : 0;
    return { variance, writerCount: writers.size, cooperation, contention };
  };

  // Aggregate: per-layer per-channel per-param field stats for CIM.
  const getStats = () => {
    const out = { L1: {}, L2: {} };
    for (const layer of LAYERS) {
      for (const [channel, ch] of field[layer].entries()) {
        out[layer][channel] = {};
        for (const [param, slot] of ch.entries()) {
          out[layer][channel][param] = _computeSlotStats(slot);
        }
      }
    }
    return out;
  };

  // Field-wide rollups: mean cooperation, mean contention, total writes,
  // writer dominance ranking. Useful for coherence signals and diagnostics.
  const getRollup = () => {
    let slotCount = 0, coopSum = 0, contSum = 0, varSum = 0, writeTotal = 0;
    const writerTotals = {};
    for (const layer of LAYERS) {
      for (const ch of field[layer].values()) {
        for (const slot of ch.values()) {
          const s = _computeSlotStats(slot);
          coopSum += s.cooperation;
          contSum += s.contention;
          varSum += s.variance;
          slotCount++;
          writeTotal += slot.writeCount;
          for (const e of slot.history) {
            writerTotals[e.writer] = (writerTotals[e.writer] || 0) + 1;
          }
        }
      }
    }
    const dominance = Object.entries(writerTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([writer, count]) => ({ writer, count }));
    return {
      slotCount,
      meanCooperation: slotCount > 0 ? coopSum / slotCount : 0,
      meanContention: slotCount > 0 ? contSum / slotCount : 0,
      meanVariance: slotCount > 0 ? varSum / slotCount : 0,
      totalWrites: writeTotal,
      dominance
    };
  };

  // CIS widening/deepening: expose structured cooperation, not only one mean.

  // Synergy buckets split deep antagonism through synergy at +/-0.4 and +/-0.1.
  const _bucket = (coop) => {
    if (coop <= -0.4) return 'deep_antagonism';
    if (coop <= -0.1) return 'antagonism';
    if (coop <  0.1)  return 'independence';
    if (coop <= 0.4)  return 'cooperation';
    return 'synergy';
  };

  const _emptyBins = () => ({
    deep_antagonism: 0, antagonism: 0, independence: 0, cooperation: 0, synergy: 0
  });

  // Per-layer rollup compares whether L1/L2 are independent or entangled.
  const _computeLayerRollup = (layer) => {
    let slotCount = 0, coopSum = 0, contSum = 0, varSum = 0, writeTotal = 0;
    const writerTotals = {};
    for (const ch of field[layer].values()) {
      for (const slot of ch.values()) {
        const s = _computeSlotStats(slot);
        coopSum += s.cooperation;
        contSum += s.contention;
        varSum += s.variance;
        slotCount++;
        writeTotal += slot.writeCount;
        for (const e of slot.history) {
          writerTotals[e.writer] = (writerTotals[e.writer] || 0) + 1;
        }
      }
    }
    return {
      slotCount,
      meanCooperation: slotCount > 0 ? coopSum / slotCount : 0,
      meanContention: slotCount > 0 ? contSum / slotCount : 0,
      meanVariance: slotCount > 0 ? varSum / slotCount : 0,
      totalWrites: writeTotal,
      writerTotals
    };
  };

  const getRollupByLayer = () => ({
    L1: _computeLayerRollup('L1'),
    L2: _computeLayerRollup('L2'),
  });

  // Per-param rollup separates multi-writer dynamics from single-writer autocorrelation.
  const getRollupByParam = () => {
    /** @type {Record<string, {totCoop:number,totCont:number,totVar:number,totN:number,mwCoop:number,mwCont:number,mwVar:number,mwN:number,swCoop:number,swN:number,writers:Set<string>}>} */
    const byParam = {};
    for (const layer of LAYERS) {
      for (const ch of field[layer].values()) {
        for (const [param, slot] of ch.entries()) {
          if (!byParam[param]) {
            byParam[param] = {
              totCoop: 0, totCont: 0, totVar: 0, totN: 0,
              mwCoop: 0, mwCont: 0, mwVar: 0, mwN: 0,
              swCoop: 0, swN: 0,
              writers: new Set(),
            };
          }
          const s = _computeSlotStats(slot);
          const agg = byParam[param];
          agg.totCoop += s.cooperation;
          agg.totCont += s.contention;
          agg.totVar += s.variance;
          agg.totN++;
          for (const e of slot.history) agg.writers.add(e.writer);
          if (s.writerCount >= 2) {
            agg.mwCoop += s.cooperation;
            agg.mwCont += s.contention;
            agg.mwVar += s.variance;
            agg.mwN++;
          } else {
            agg.swCoop += s.cooperation;
            agg.swN++;
          }
        }
      }
    }
    /** @type {Record<string, {slotCount:number,meanCooperation:number,meanContention:number,meanVariance:number,writerCount:number,multiWriter:{slotCount:number,meanCooperation:number,meanContention:number,meanVariance:number},singleWriter:{slotCount:number,meanCooperation:number}}>} */
    const out = {};
    for (const [param, agg] of Object.entries(byParam)) {
      out[param] = {
        slotCount: agg.totN,
        meanCooperation: agg.totN > 0 ? agg.totCoop / agg.totN : 0,
        meanContention: agg.totN > 0 ? agg.totCont / agg.totN : 0,
        meanVariance: agg.totN > 0 ? agg.totVar / agg.totN : 0,
        writerCount: agg.writers.size,
        multiWriter: {
          slotCount: agg.mwN,
          meanCooperation: agg.mwN > 0 ? agg.mwCoop / agg.mwN : 0,
          meanContention: agg.mwN > 0 ? agg.mwCont / agg.mwN : 0,
          meanVariance: agg.mwN > 0 ? agg.mwVar / agg.mwN : 0,
        },
        singleWriter: {
          slotCount: agg.swN,
          meanCooperation: agg.swN > 0 ? agg.swCoop / agg.swN : 0,
        },
      };
    }
    return out;
  };

  // Synergy spectrum bins cooperation while separating single vs multi-writer slots.
  const getSynergySpectrum = () => {
    const globalBins = _emptyBins();
    const multiWriterBins = _emptyBins();
    /** @type {Record<string, Record<string, number>>} */
    const perLayer = {};
    for (const layer of LAYERS) perLayer[layer] = _emptyBins();
    let multiWriterSlots = 0, totalSlots = 0;
    let trueSynergyCount = 0, trueAntagonismCount = 0;
    const hotspots = []; // slots in deep synergy or deep antagonism with multi-writer
    for (const layer of LAYERS) {
      for (const [channel, ch] of field[layer].entries()) {
        for (const [param, slot] of ch.entries()) {
          const s = _computeSlotStats(slot);
          const bucket = _bucket(s.cooperation);
          globalBins[bucket]++;
          perLayer[layer][bucket]++;
          totalSlots++;
          if (s.writerCount >= 2) {
            multiWriterBins[bucket]++;
            multiWriterSlots++;
            if (bucket === 'synergy') {
              trueSynergyCount++;
              hotspots.push({ layer, channel, param, cooperation: s.cooperation, kind: 'synergy' });
            }
            if (bucket === 'deep_antagonism') {
              trueAntagonismCount++;
              hotspots.push({ layer, channel, param, cooperation: s.cooperation, kind: 'deep_antagonism' });
            }
          }
        }
      }
    }
    // Order hotspots by absolute cooperation (most extreme first).
    hotspots.sort((a, b) => m.abs(b.cooperation) - m.abs(a.cooperation));
    return {
      globalBins,
      multiWriterBins,
      perLayer,
      totalSlots,
      multiWriterSlots,
      trueSynergyCount,
      trueAntagonismCount,
      hotspots: hotspots.slice(0, 12),
    };
  };

  // Cross-param correlation compares cooperation regimes across param pairs.
  // Uses signed magnitude product, avoiding time-aligned history requirements.
  const getCrossParamCorrelations = (limit = 20) => {
    const pairs = [];
    for (const layer of LAYERS) {
      for (const [channel, ch] of field[layer].entries()) {
        const paramStats = [];
        for (const [param, slot] of ch.entries()) {
          const s = _computeSlotStats(slot);
          if (s.writerCount >= 2) {
            paramStats.push({ param, cooperation: s.cooperation });
          }
        }
        // Emit all pairs within this channel.
        for (let i = 0; i < paramStats.length; i++) {
          for (let j = i + 1; j < paramStats.length; j++) {
            const a = paramStats[i];
            const b = paramStats[j];
            // Correlation sign: +1 if both cooperate or both antagonize,
            // -1 if opposing. Magnitude: product of |coop| values.
            const sign = m.sign(a.cooperation) * m.sign(b.cooperation);
            const magnitude = m.abs(a.cooperation) * m.abs(b.cooperation);
            const correlation = sign * magnitude;
            pairs.push({
              layer, channel,
              paramA: a.param, paramB: b.param,
              coopA: a.cooperation, coopB: b.cooperation,
              correlation,
            });
          }
        }
      }
    }
    pairs.sort((x, y) => m.abs(y.correlation) - m.abs(x.correlation));
    return pairs.slice(0, limit);
  };

  const reset = () => {
    for (const layer of LAYERS) field[layer].clear();
  };

  return {
    write, observeControl, read, recentTrend,
    getFieldSnapshot, getStats, getRollup,
    getRollupByLayer, getRollupByParam, getSynergySpectrum,
    getCrossParamCorrelations,
    reset
  };
})();
