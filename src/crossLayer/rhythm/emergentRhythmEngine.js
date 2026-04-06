// src/crossLayer/rhythm/emergentRhythmEngine.js
// Accumulates cross-layer interaction events (stutterContagion, emergentDownbeat,
// feedbackLoop, convergence, cadenceAlignment, regimeTransition, articulation)
// within a regime-adaptive rolling window, quantizes them to a 16-slot grid,
// and biases rhythm pattern selection toward emergent rhythmic structure.
// biasRhythmWeights() chains after journeyRhythmCoupler in getRhythm.js (4th link).
// Self-calibrating: running density EMA adjusts grid sensitivity threshold.

emergentRhythmEngine = (() => {
  const V = validator.create('emergentRhythmEngine');
  const GRID_SIZE = 16;
  const DENSITY_EMA_ALPHA = 0.08;
  const COMPLEXITY_EMA_ALPHA = 0.06;

  let lastDensity = 0;
  let lastComplexity = 0;
  let lastBiasStrength = 0;
  let densityEma = 0;
  let complexityEma = 0;
  let lastGrid = new Array(GRID_SIZE).fill(0);
  let cimScale = 0.5;
  let cachedBeatTime = -1;
  let cachedResult = null;

  function toSlot(evtTime, windowStart, windowDuration) {
    const phase = clamp((evtTime - windowStart) / windowDuration, 0, 0.9999);
    return m.floor(phase * GRID_SIZE);
  }

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

  function computeComplexity(grid) {
    const threshold = 0.20 + densityEma * 0.15; // self-calibrating threshold
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

  function buildGrid() {
    if (!Number.isFinite(beatStartTime) || !Number.isFinite(spBeat)) return null;
    // Per-beat cache: getRhythm calls biasRhythmWeights 4x per beat (beat/div/subdiv/subsubdiv)
    if (beatStartTime === cachedBeatTime && cachedResult) return cachedResult;
    cachedBeatTime = beatStartTime;

    const regime = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'evolving');
    const windowBeats = regime === 'exploring' ? 3 : regime === 'coherent' ? 1.5 : 2;
    const windowDuration = spBeat * windowBeats;
    const windowStart = beatStartTime - windowDuration;

    const grid = new Array(GRID_SIZE).fill(0);

    // Low-frequency L0 channels: query() is safe (small event counts)
    stampEvents(L0.query('stutterContagion', { since: windowStart }),
      windowStart, windowDuration, grid, 0.55, false);
    stampEvents(L0.query('emergentDownbeat', { since: windowStart }),
      windowStart, windowDuration, grid, 0.75, true);
    stampEvents(L0.query('feedbackLoop', { since: windowStart }),
      windowStart, windowDuration, grid, 0.40, false);
    // convergence-density (not onset -- onset has 250k+ events)
    stampEvents(L0.query('convergence-density', { since: windowStart }),
      windowStart, windowDuration, grid, 0.30, true);
    stampEvents(L0.query('regimeTransition', { since: windowStart }),
      windowStart, windowDuration, grid, 0.50, true);

    // High-frequency channels: getLast() only (O(1) reverse scan)
    const cadenceEntry = L0.getLast('cadenceAlignment', { since: windowStart });
    if (cadenceEntry && Number.isFinite(cadenceEntry.timeInSeconds)) {
      const slot = toSlot(cadenceEntry.timeInSeconds, windowStart, windowDuration);
      const strength = V.optionalFinite(cadenceEntry.strength, 0.5);
      grid[slot] = clamp(grid[slot] + strength * 0.35, 0, 1);
      if (slot > 0) grid[slot - 1] = clamp(grid[slot - 1] + strength * 0.12, 0, 1);
      if (slot < GRID_SIZE - 1) grid[slot + 1] = clamp(grid[slot + 1] + strength * 0.12, 0, 1);
    }

    const cimMod = 0.7 + cimScale * 0.6;
    for (let i = 0; i < GRID_SIZE; i++) grid[i] = clamp(grid[i] * cimMod, 0, 1);

    const density = grid.reduce((s, v) => s + v, 0) / GRID_SIZE;
    const complexity = density > 0.01 ? computeComplexity(grid) : 0;

    densityEma += (density - densityEma) * DENSITY_EMA_ALPHA;
    complexityEma += (complexity - complexityEma) * COMPLEXITY_EMA_ALPHA;

    lastDensity = density;
    lastComplexity = complexity;
    lastGrid = grid;

    // Compute bias strength once per beat (not per getRhythm call)
    const regimeScale = regime === 'exploring' ? 1.5 : regime === 'coherent' ? 0.4 : 1.0;
    const densitySurprise = density > densityEma * 1.2 ? 1.3 : density < densityEma * 0.8 ? 0.7 : 1.0;
    const biasStrength = density >= 0.03
      ? clamp(complexity * density * regimeScale * densitySurprise * 2.5, 0, 0.9)
      : 0;
    lastBiasStrength = biasStrength;

    // Post to L0 once per beat (not per getRhythm level)
    if (biasStrength >= 0.03) {
      const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
      const hotspots = grid.map((v, i) => (v > 0.3 ? i : -1)).filter(i => i >= 0);
      L0.post('emergentRhythm', layer, beatStartTime, {
        density, complexity, hotspots, densitySurprise, biasStrength, complexityEma
      });
    }

    const complexityBias = (complexity - 0.5) * 2; // -1 to +1
    cachedResult = { grid, density, complexity, regime, biasStrength, complexityBias };
    return cachedResult;
  }

  function biasRhythmWeights(rhythmsObj) {
    V.assertObject(rhythmsObj, 'rhythmsObj');

    const result = buildGrid();
    if (!result || result.biasStrength < 0.03) return rhythmsObj;

    const { biasStrength, complexityBias } = result;
    const modified = {};
    for (const [key, spec] of Object.entries(rhythmsObj)) {
      if (!spec || !Array.isArray(spec.weights)) { modified[key] = spec; continue; }
      const newWeights = spec.weights.map((w, idx) => {
        const wN = V.optionalFinite(Number(w), 0.1);
        const position = idx / spec.weights.length;
        const boost = (position - 0.5) * complexityBias * biasStrength * 0.35;
        return m.max(0.1, wN + boost);
      });
      modified[key] = { ...spec, weights: newWeights };
    }
    return modified;
  }

  function getDensity()       { return lastDensity; }
  function getComplexity()    { return lastComplexity; }
  function getBiasStrength()  { return lastBiasStrength; }
  function getDensityEma()    { return densityEma; }
  function getGrid()          { return lastGrid; }
  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  function reset() {
    lastDensity = 0;
    lastComplexity = 0;
    lastBiasStrength = 0;
    densityEma = 0;
    complexityEma = 0;
    lastGrid = new Array(GRID_SIZE).fill(0);
    cimScale = 0.5;
    cachedBeatTime = -1;
    cachedResult = null;
  }

  crossLayerRegistry.register('emergentRhythmEngine', { reset }, ['all']);

  feedbackRegistry.registerLoop(
    'emergentRhythmPort',
    'stutterContagion_downbeat_feedbackLoop',
    'rhythm_pattern_weights',
    () => clamp(lastBiasStrength, 0, 1),
    () => lastDensity > 0.04 ? 1 : 0
  );

  return {
    biasRhythmWeights, getDensity, getComplexity, getBiasStrength,
    getDensityEma, getGrid, setCoordinationScale, reset
  };
})();
