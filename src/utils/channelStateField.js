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
  const HISTORY_DEPTH = 16;
  const LAYERS = ['L1', 'L2'];

  // CC number -> param name. Unmapped CCs are ignored by observeControl.
  const CC_TO_PARAM = { 7: 'fade', 10: 'pan', 11: 'fx', 1: 'mod' };

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

  const reset = () => {
    for (const layer of LAYERS) field[layer].clear();
  };

  return { write, observeControl, read, getFieldSnapshot, getStats, getRollup, reset };
})();
