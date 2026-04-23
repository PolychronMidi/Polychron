// channelStateField.js - living substrate tracking per-channel per-layer
// parameter state (pan/fade/fx/velocity) with writer lineage.
//
// Emitters mutate in place; observers (CIM, grandFinale forensics) sample
// the whole field on their own cadence and compute field statistics from it
// (variance = collision density, directional correlation = cooperation /
// antagonism). Not an event system -- collisions, cooperation, antagonism
// are FIELD properties, not discrete events.
//
// Cost: O(1) per write, bounded history per slot. Slots are ~2 layers *
// ~30 channels * ~4 params = ~240 slots; trivial storage.
//
// Writers identify themselves by a stable string tag; CIM uses the tag
// distribution to derive per-module dominance and contention locality.

channelStateField = (() => {
  const V = validator.create('channelStateField');
  // R35 set depth to 16; R36 tried 48 to make slower writers visible; R37
  // rollup showed meanContention dropped 0.084 -> 0.046 because each slot's
  // 48-entry window filled with more setBalanceAndFX entries (which writes
  // ~50 CCs per invocation), shrinking weaker writers' share of the window
  // even as their absolute write count grew. Reverted to 16 so the stat
  // reflects recent contention honestly. regimePan's sub-beat firing gives
  // it real visibility at depth=16 without needing the depth expansion.
  const HISTORY_DEPTH = 16;
  const LAYERS = ['L1', 'L2'];

  // CC number -> param name. Unmapped CCs are ignored by observeControl.
  // R47: expanded from {1,7,10,11,74} to cover every CC that
  // setBalanceAndFX's rfx path emits. Prior narrow map meant CIS was
  // blind to ~60 CC writes per setBalanceAndFX fire (CC5, CC65-73, CC91-95)
  // that bypassed the substrate entirely. Now every CC setBalanceAndFX
  // writes gets its own slot dimension so the cooperation post-pass can
  // read its own trend and nudge trend-aligned. Each CC uses a distinct
  // param name so histories don't pollute across dimensions.
  const CC_TO_PARAM = {
    1:  'mod',         // modulation wheel
    5:  'portTime',    // portamento time
    7:  'fade',        // channel volume
    10: 'pan',         // pan
    11: 'fx',          // expression / velocity-scaler
    65: 'portSwitch',  // portamento on/off
    67: 'softPedal',   // soft pedal
    68: 'legato',      // legato footswitch
    69: 'hold2',       // hold 2
    70: 'soundVar',    // sound variation (GM2 timbre)
    71: 'resonance',   // filter resonance
    72: 'release',     // release time
    73: 'attack',      // attack time
    74: 'filter',      // filter cutoff / brightness
    91: 'reverb',      // reverb send
    92: 'tremolo',     // tremolo depth
    93: 'chorus',      // chorus send
    94: 'celeste',     // celeste / detune depth
    95: 'phaser',      // phaser depth
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
    return ch ? (ch.get(param) || null) : null;
  };

  // Inferred direction of recent writes on a slot (-1 descending, 0 flat /
  // insufficient data, +1 ascending). Used by regime writers' cooperation
  // mode: when enabled, the writer can read this and push in the same
  // direction to create synergy rather than antagonism.
  //
  // R40 diagnostic: fieldByParam showed fade = +0.416 (cooperation), filter
  // = -0.794 (deep antagonism). Fade writers share a temporal direction
  // (stutterFade dip-recover envelope); filter writers don't. This helper
  // lets any regime writer opt in to cooperation via substrate awareness.
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

  // Per-slot field statistics. variance = collision density over the
  // history window; writerCount = distinct writers in window; cooperation
  // in [-1, 1] measures directional agreement (+1 consecutive writes
  // push same direction = cooperation; -1 always reverse = antagonism);
  // contention = writerCount / historyLength (1.0 = every write from
  // a different source).
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

  // ==== CIS widening/deepening (R39+) ====
  //
  // The scalar meanCooperation gives CIM one number for the whole field.
  // Real synergy has structure: different layers can cooperate differently,
  // different params (pan vs fade vs filter) have different cooperation
  // regimes, and the distribution across slots matters as much as the mean
  // (a mean of 0 from [+1, -1, +1, -1] is very different from [0, 0, 0, 0]).
  //
  // These extended accessors give CIM the full trajectory from deep
  // antagonism through independence to synergy.

  // Bucket the cooperation scalar into the synergy spectrum.
  //   [-1.0, -0.4)  deep_antagonism  -- writers strictly oppose
  //   [-0.4, -0.1)  antagonism       -- mostly opposing
  //   [-0.1, +0.1]  independence     -- no consistent directional relation
  //   (+0.1, +0.4]  cooperation      -- mostly aligned
  //   (+0.4, +1.0]  synergy          -- strictly aligned pushes
  //
  // R43: thresholds tightened from +/-0.5 to +/-0.4 because R39-R42 never
  // populated synergy at +/-0.5.
  //
  // R46 forensic finding: trueSynergyCount=0 is STRUCTURAL, not a
  // threshold artifact. Multi-writer slots topped out at +0.333 (single
  // pan slot, 3 writers); no multi-writer slot crossed +0.4 on any
  // dimension across 7 cooperation-amplification rounds. Root cause:
  // writers have different value CENTERS (setBalanceAndFX rfx picks
  // random in FX_CC_DEFAULTS range; regimeFx centers around 80; etc).
  // Cooperation-mode aligns DIRECTIONS but can't overcome different
  // centers. Fix would require channel-convergence forcing or center
  // alignment -- both trade off against other goals. Accepted as the
  // ecology's structural ceiling under current writer architecture.
  // The synergy bucket exists for completeness but is expected to stay
  // near-zero for multi-writer slots. Single-writer slots CAN populate
  // it via auto-correlation, which is now split out in getRollupByParam.
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

  // Per-layer rollup: same shape as getRollup() but computed per layer so
  // L1 vs L2 cooperation can be compared. Reveals whether the two
  // polyrhythmic layers are independent or entangled in their emission
  // ecology.
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

  // Per-param rollup: cooperation/contention aggregated by param name
  // across every (layer, channel) that has that param. Answers questions
  // like "is pan dimension in synergy while filter is in antagonism?"
  // R46 forensic finding: the flat per-param aggregate conflated two
  // very different things -- (a) cross-writer dynamics on multi-writer
  // slots and (b) auto-correlation patterns on single-writer slots. fade
  // aggregate read +0.471 for 29 single-writer slots and -0.429 on the
  // 1 multi-writer slot, but the aggregate metric hid that. This split
  // reports multiWriter separately so cross-module cooperation can't be
  // confused with single-writer value-sequence auto-correlation.
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

  // Synergy spectrum: histogram of slots binned by cooperation value.
  // Separates single-writer slots (where "cooperation" just reflects value
  // auto-correlation) from multi-writer slots (where cooperation or
  // antagonism is a real cross-module phenomenon). True synergy requires
  // >= 2 distinct writers AND alignment >= +0.5; true antagonism requires
  // >= 2 writers AND alignment <= -0.5. Single-writer high-cooperation is
  // just one voice moving smoothly; not the physics we're measuring.
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

  // Cross-param correlation: for each (layer, channel) that has >=2 param
  // slots with writerCount>=2, compute the cooperation correlation between
  // each PAIR of params. Answers structural questions:
  //   - Does pan antagonism on channel X track with filter antagonism on
  //     channel X? (writers fighting on same slots vs orthogonal)
  //   - Which channels have dimensions in DIFFERENT cooperation regimes?
  //
  // Returns pairs sorted by |correlation|, up to N entries. Each entry is
  //   { layer, channel, paramA, paramB, coopA, coopB, correlation }
  // where correlation is the product of the two cooperation signs weighted
  // by their magnitudes -- a simple similarity measure without needing
  // time-aligned slot histories.
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
