// src/crossLayer/rhythm/emergentRhythmEngine.js
// Accumulates cross-layer interaction events (stutterContagion, emergentDownbeat,
// feedbackLoop) within a rolling beat window, quantizes them to a 16-slot
// subdivision grid, and biases rhythm pattern selection toward emergent rhythmic
// structure -- bottom-up rhythm arising from inter-layer musical behavior.
// biasRhythmWeights() chains after journeyRhythmCoupler in getRhythm.js (4th link).

emergentRhythmEngine = (() => {
  const V = validator.create('emergentRhythmEngine');
  const GRID_SIZE = 16;
  const WINDOW_BEATS = 2;

  let lastDensity = 0;
  let lastComplexity = 0;
  let lastBiasStrength = 0;

  /**
   * Map an event's absolute time to a grid slot within [windowStart, windowStart+duration).
   * Earlier events -> lower slots, more recent -> higher slots.
   */
  function toSlot(evtTime, windowStart, windowDuration) {
    const phase = clamp((evtTime - windowStart) / windowDuration, 0, 0.9999);
    return m.floor(phase * GRID_SIZE);
  }

  /**
   * Stamp L0 query results into the grid.
   * @param {Array} events - L0.query result
   * @param {number} windowStart - absolute seconds start of window
   * @param {number} windowDuration - total window duration in seconds
   * @param {number[]} grid - mutable grid array (length GRID_SIZE)
   * @param {number} amplitude - scale factor for contributions
   * @param {boolean} spread - stamp adjacent slots too (for strong downbeat events)
   */
  function stampEvents(events, windowStart, windowDuration, grid, amplitude, spread) {
    for (const evt of events) {
      if (!Number.isFinite(evt.timeInSeconds)) continue;
      const intensity = V.optionalFinite(
        evt.intensity !== undefined ? evt.intensity
          : evt.strength !== undefined ? evt.strength
            : evt.energy !== undefined ? evt.energy : 0,
        0
      );
      if (intensity < 0.05) continue;
      const slot = toSlot(evt.timeInSeconds, windowStart, windowDuration);
      const contrib = intensity * amplitude;
      grid[slot] = clamp(grid[slot] + contrib, 0, 1);
      if (spread) {
        if (slot > 0)             grid[slot - 1] = clamp(grid[slot - 1] + contrib * 0.35, 0, 1);
        if (slot < GRID_SIZE - 1) grid[slot + 1] = clamp(grid[slot + 1] + contrib * 0.35, 0, 1);
      }
    }
  }

  /**
   * Compute syncopation complexity from a grid (0 = steady/sparse, 1 = dense/syncopated).
   * @param {number[]} grid
   * @returns {number}
   */
  function computeComplexity(grid) {
    const threshold = 0.25;
    let transitions = 0;
    let runLen = 0;
    let maxRun = 0;
    let hotCount = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      const hot = grid[i] > threshold;
      if (hot) { hotCount++; runLen++; }
      else     { maxRun = m.max(maxRun, runLen); runLen = 0; }
      if (i > 0 && (grid[i] > threshold) !== (grid[i - 1] > threshold)) transitions++;
    }
    maxRun = m.max(maxRun, runLen);
    const syncopation = clamp(transitions / (GRID_SIZE * 0.5), 0, 1);
    const dispersion = hotCount > 1 ? clamp(1 - maxRun / hotCount, 0, 1) : 0;
    return clamp(syncopation * 0.6 + dispersion * 0.4, 0, 1);
  }

  /**
   * Bias rhythm weights based on emergent cross-layer event density and pattern complexity.
   * High complexity + density -> favor syncopated/complex patterns (high weight index).
   * High density + low complexity -> favor steady/driving patterns (low weight index).
   * Chains after journeyRhythmCoupler in getRhythm.js.
   * @param {Object} rhythmsObj - rhythm lookup with weights
   * @returns {Object} copy with emergent-pattern-biased weights
   */
  function biasRhythmWeights(rhythmsObj) {
    V.assertObject(rhythmsObj, 'rhythmsObj');

    if (!Number.isFinite(beatStartTime) || !Number.isFinite(spBeat)) return rhythmsObj;

    const windowDuration = spBeat * WINDOW_BEATS;
    const windowStart = beatStartTime - windowDuration;
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';

    // Build fresh grid from recent L0 events across both layers
    const grid = new Array(GRID_SIZE).fill(0);
    stampEvents(L0.query('stutterContagion', { since: windowStart }),
      windowStart, windowDuration, grid, 0.55, false);
    stampEvents(L0.query('emergentDownbeat', { since: windowStart }),
      windowStart, windowDuration, grid, 0.75, true);
    stampEvents(L0.query('feedbackLoop', { since: windowStart }),
      windowStart, windowDuration, grid, 0.40, false);

    const density = grid.reduce((s, v) => s + v, 0) / GRID_SIZE;
    const complexity = density > 0.01 ? computeComplexity(grid) : 0;
    lastDensity = density;
    lastComplexity = complexity;

    if (density < 0.04) {
      lastBiasStrength = 0;
      return rhythmsObj;
    }

    const profSnap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const regime = profSnap && profSnap.regime ? profSnap.regime : 'evolving';
    const regimeScale = regime === 'exploring' ? 1.4 : regime === 'coherent' ? 0.5 : 1.0;
    const biasStrength = clamp(complexity * density * regimeScale * 2.0, 0, 0.8);
    lastBiasStrength = biasStrength;

    if (biasStrength < 0.03) return rhythmsObj;

    // Post emergent pattern to L0 for downstream readers (e.g. crossModulateRhythms)
    const hotspots = grid.map((v, i) => (v > 0.3 ? i : -1)).filter(i => i >= 0);
    L0.post('emergentRhythm', layer, beatStartTime, { density, complexity, hotspots });

    // complexity > 0.5 -> boost syncopated patterns (high index); < 0.5 -> boost steady (low index)
    const complexityBias = (complexity - 0.5) * 2; // -1 to +1
    const modified = {};
    for (const [key, spec] of Object.entries(rhythmsObj)) {
      if (!spec || !Array.isArray(spec.weights)) { modified[key] = spec; continue; }
      const newWeights = spec.weights.map((w, idx) => {
        const wN = V.optionalFinite(Number(w), 0.1);
        const position = idx / spec.weights.length; // 0 = simple, 1 = complex
        const boost = (position - 0.5) * complexityBias * biasStrength * 0.3;
        return m.max(0.1, wN + boost);
      });
      modified[key] = { ...spec, weights: newWeights };
    }
    return modified;
  }

  function getDensity()    { return lastDensity; }
  function getComplexity() { return lastComplexity; }

  function reset() {
    lastDensity = 0;
    lastComplexity = 0;
    lastBiasStrength = 0;
  }

  crossLayerRegistry.register('emergentRhythmEngine', { reset }, ['all']);

  feedbackRegistry.registerLoop(
    'emergentRhythmPort',
    'stutterContagion_downbeat_feedbackLoop',
    'rhythm_pattern_weights',
    () => clamp(lastBiasStrength, 0, 1),
    () => lastDensity > 0.04 ? 1 : 0
  );

  return { biasRhythmWeights, getDensity, getComplexity, reset };
})();
