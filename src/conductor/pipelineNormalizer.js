// pipelineNormalizer.js — Adaptive soft-envelope normalization for signal pipelines.
//
// Replaces static floors/ceilings (DENSITY_PRODUCT_FLOOR, TENSION_PRODUCT_CEILING)
// with smooth exponential compression that is C1-continuous at boundaries.
//
// Within [softMin, softMax]: product passes through unchanged.
// Below softMin: exponentially compressed toward hardMin (softMin − range).
// Above softMax: exponentially compressed toward hardMax (softMax + range).
//
// Eliminates the need for manual per-module floor/ceiling tuning iterations.
// Profile-independent: compresses extremes proportionally regardless of how
// many modules contribute or which profile is active.

pipelineNormalizer = (() => {
  const V = Validator.create('pipelineNormalizer');

  // Soft-envelope boundaries per pipeline, calibrated from observed products.
  // softMin/softMax: compression onset thresholds (passthrough zone).
  // range: compression depth; hard floor = softMin − range, hard ceiling = softMax + range.
  const BOUNDS = {
    density: { softMin: 0.65, softMax: 1.35, range: 0.20 },
    tension: { softMin: 0.70, softMax: 1.25, range: 0.20 },
    flicker: { softMin: 0.70, softMax: 1.30, range: 0.15 }
  };

  const TRACKING_ALPHA = 0.04;
  const WARMUP_BEATS   = 6;
  const WARMUP_ALPHA   = 0.25;

  const _state = {
    density: { emaRaw: 1.0, beats: 0, lastBeat: -1 },
    tension: { emaRaw: 1.0, beats: 0, lastBeat: -1 },
    flicker: { emaRaw: 1.0, beats: 0, lastBeat: -1 }
  };

  /**
   * Exponential soft envelope. C1-continuous at boundaries.
   * Identity within [softMin, softMax]; exponential compression outside.
   * @param {number} value
   * @param {number} softMin
   * @param {number} softMax
   * @param {number} range
   * @returns {number}
   */
  function _softEnvelope(value, softMin, softMax, range) {
    if (value >= softMin && value <= softMax) return value;
    if (value < softMin) {
      const d = softMin - value;
      return softMin - range * (1 - m.exp(-d / range));
    }
    const d = value - softMax;
    return softMax + range * (1 - m.exp(-d / range));
  }

  /**
   * Normalize a pipeline product through the soft envelope.
   * @param {'density'|'tension'|'flicker'} pipeline
   * @param {number} rawProduct — from _collectDampened
   * @returns {number}
   */
  function normalize(pipeline, rawProduct) {
    V.requireFinite(rawProduct, 'rawProduct');
    const bounds = BOUNDS[pipeline];
    if (!bounds) throw new Error(`pipelineNormalizer: unknown pipeline "${pipeline}"`);

    const s = _state[pipeline];
    const bc = beatCount;
    if (bc !== s.lastBeat) {
      s.lastBeat = bc;
      s.beats++;
      const alpha = s.beats <= WARMUP_BEATS ? WARMUP_ALPHA : TRACKING_ALPHA;
      s.emaRaw += alpha * (rawProduct - s.emaRaw);
    }

    return _softEnvelope(rawProduct, bounds.softMin, bounds.softMax, bounds.range);
  }

  function reset() {
    for (const key of Object.keys(_state)) {
      _state[key].emaRaw = 1.0;
      _state[key].beats = 0;
      _state[key].lastBeat = -1;
    }
  }

  /** @returns {Record<string, object>} */
  function getSnapshot() {
    const result = {};
    for (const [pipeline, s] of Object.entries(_state)) {
      const b = BOUNDS[pipeline];
      result[pipeline] = {
        emaRawProduct: Number(s.emaRaw.toFixed(4)),
        beats: s.beats,
        softMin: b.softMin,
        softMax: b.softMax,
        hardMin: Number((b.softMin - b.range).toFixed(2)),
        hardMax: Number((b.softMax + b.range).toFixed(2))
      };
    }
    return result;
  }

  ConductorIntelligence.registerModule('pipelineNormalizer', { reset }, ['all']);

  return { normalize, reset, getSnapshot };
})();
