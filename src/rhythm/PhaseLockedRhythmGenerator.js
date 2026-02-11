// src/rhythm/PhaseLockedRhythmGenerator.js - Phase-locked polyrhythmic generation
// Enables explicit polyrhythmic interlocking via phase offset tracking
// Reflects African music principles: cyclic patterns with phase relationships

PhaseLockedRhythmGenerator = (() => {
  const phases = new Map();         // Map<layerName:patternName:length, offset>
  const generationHistory = [];     // Track recent generations for coherence analysis
  let activeLayer = null;           // Track which layer is currently active for phase context

  /**
   * Set active layer context for phase tracking
   * @param {string} layerName - Layer name (e.g., 'L1', 'L2')
   * @returns {void}
   */
  function setActiveLayer(layerName) {
    if (typeof layerName !== 'string' || !layerName) {
      throw new Error('PhaseLockedRhythmGenerator.setActiveLayer: layerName must be non-empty string');
    }
    activeLayer = layerName;
  }

  /**
   * Initialize polyrhythmic cross-layer phase relationship
   * @param {string} layer1 - First layer name
   * @param {string} layer2 - Second layer name
   * @param {number} ratio1 - Measures for layer1 in polyrhythm cycle
   * @param {number} ratio2 - Measures for layer2 in polyrhythm cycle
   * @returns {void}
   */
  function initializePolyrhythmCoupling(layer1, layer2, ratio1, ratio2) {
    if (typeof layer1 !== 'string' || !layer1 || typeof layer2 !== 'string' || !layer2) {
      throw new Error('PhaseLockedRhythmGenerator.initializePolyrhythmCoupling: layer names must be non-empty strings');
    }
    if (!Number.isInteger(ratio1) || ratio1 <= 0 || !Number.isInteger(ratio2) || ratio2 <= 0) {
      throw new Error(`PhaseLockedRhythmGenerator.initializePolyrhythmCoupling: ratios must be positive integers (got ${ratio1}, ${ratio2})`);
    }
    // Phase offset based on ratio: layer2 offset = (ratio1 / (ratio1 + ratio2)) * pattern_length
    // This is computed dynamically per pattern to maintain polyrhythmic coherence
    // Store coupling metadata for reference
    phases.set(`_coupling:${layer1}:${layer2}`, { ratio1, ratio2 });
  }

  /**
   * Generate rhythm pattern with phase locking (layer-aware)
   * @param {number} length - Pattern length
   * @param {string} patternName - Name of pattern generator (must be registered in RhythmRegistry)
   * @param {number} [phaseOffset] - Optional explicit phase offset; uses stored phase if omitted
   * @returns {Array} rotated rhythm pattern
   * @throws {Error} if length invalid, patternName not found, or offset calculation fails
   */
  function generate(length, patternName, phaseOffset = undefined) {
    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`PhaseLockedRhythmGenerator.generate: length must be positive integer, got ${length}`);
    }

    if (typeof patternName !== 'string' || !patternName) {
      throw new Error('PhaseLockedRhythmGenerator.generate: patternName must be non-empty string');
    }

    // Generate base pattern via RhythmRegistry
    if (typeof RhythmRegistry === 'undefined') {
      throw new Error('PhaseLockedRhythmGenerator.generate: RhythmRegistry not available');
    }

    let pattern;
    try {
      pattern = RhythmRegistry.execute(patternName, length);
    } catch (e) {
      throw new Error(`PhaseLockedRhythmGenerator.generate: failed to execute pattern "${patternName}": ${e && e.message ? e.message : e}`);
    }

    if (!Array.isArray(pattern) || pattern.length === 0) {
      throw new Error(`PhaseLockedRhythmGenerator.generate: pattern "${patternName}" returned invalid result`);
    }

    // Determine phase offset using (layerName:patternName, length) tuple key
    const phaseKeyBase = activeLayer ? `${activeLayer}:${patternName}` : patternName;
    const phaseKey = `${phaseKeyBase}:${length}`;
    let offset = 0;
    if (typeof phaseOffset === 'number' && Number.isFinite(phaseOffset)) {
      offset = phaseOffset;
    } else if (phases.has(phaseKey)) {
      offset = phases.get(phaseKey);
    } else if (activeLayer) {
      for (const [key, meta] of phases.entries()) {
        if (typeof key !== 'string' || !key.startsWith('_coupling:')) continue;
        const parts = key.split(':');
        const layer1 = parts[1];
        const layer2 = parts[2];
        if (activeLayer !== layer2) continue;
        const ratio1 = meta && Number.isFinite(Number(meta.ratio1)) ? Number(meta.ratio1) : null;
        const ratio2 = meta && Number.isFinite(Number(meta.ratio2)) ? Number(meta.ratio2) : null;
        if (ratio1 && ratio2) {
          offset = Math.round((ratio1 / (ratio1 + ratio2)) * length);
          break;
        }
      }
    }

    offset = ((offset % length) + length) % length; // Normalize to [0, length)

    // Rotate pattern by offset
    if (typeof rotate === 'undefined') {
      throw new Error('PhaseLockedRhythmGenerator.generate: rotate() function not available');
    }

    let rotated;
    try {
      rotated = rotate(pattern, offset, 'R', length);
    } catch (e) {
      throw new Error(`PhaseLockedRhythmGenerator.generate: rotate() failed: ${e && e.message ? e.message : e}`);
    }

    if (!Array.isArray(rotated)) {
      throw new Error('PhaseLockedRhythmGenerator.generate: rotate() did not return array');
    }

    // Note: same pattern can legitimately be used at different lengths for different metrical levels
    // Phase tracking per (patternName, length) tuple allows this

    // Record generation for history
    generationHistory.push({
      patternName,
      length,
      offset,
    });

    return rotated;
  }

  /**
   * Lock pattern to specific phase offset
   * @param {string} patternName - Pattern name
   * @param {number} length - Pattern length (required for phase key tuple)
   * @param {number} phase - Phase offset to lock to
   * @throws {Error} if phase not a valid number
   */
  function lock(patternName, length, phase) {
    if (typeof patternName !== 'string' || !patternName) {
      throw new Error('PhaseLockedRhythmGenerator.lock: patternName must be non-empty string');
    }

    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`PhaseLockedRhythmGenerator.lock: length must be positive integer, got ${length}`);
    }

    if (typeof phase !== 'number' || !Number.isFinite(phase)) {
      throw new Error(`PhaseLockedRhythmGenerator.lock: phase must be finite number, got ${phase}`);
    }

    const phaseKeyBase = activeLayer ? `${activeLayer}:${patternName}` : patternName;
    const phaseKey = `${phaseKeyBase}:${length}`;
    phases.set(phaseKey, phase);
  }

  /**
   * Get current phase for a pattern
   * @param {string} patternName - Pattern name
   * @param {number} length - Pattern length (required for phase key tuple)
   * @returns {number} current phase offset (0 if not yet set)
   */
  function getPhase(patternName, length) {
    if (typeof patternName !== 'string' || !patternName) {
      throw new Error('PhaseLockedRhythmGenerator.getPhase: patternName must be non-empty string');
    }

    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`PhaseLockedRhythmGenerator.getPhase: length must be positive integer, got ${length}`);
    }

    const phaseKeyBase = activeLayer ? `${activeLayer}:${patternName}` : patternName;
    const phaseKey = `${phaseKeyBase}:${length}`;
    return phases.get(phaseKey) || 0;
  }

  /**
   * Advance phase for a pattern (rotate by delta)
   * @param {string} patternName - Pattern name
   * @param {number} length - Pattern length (required for phase key tuple)
   * @param {number} delta - Amount to advance (can be negative)
   * @param {number} [modulo] - Wrap phase to this value (default: no wrap)
   * @throws {Error} if delta not a valid number
   */
  function advancePhase(patternName, length, delta, modulo = undefined) {
    if (typeof patternName !== 'string' || !patternName) {
      throw new Error('PhaseLockedRhythmGenerator.advancePhase: patternName must be non-empty string');
    }

    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`PhaseLockedRhythmGenerator.advancePhase: length must be positive integer, got ${length}`);
    }

    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      throw new Error(`PhaseLockedRhythmGenerator.advancePhase: delta must be finite number, got ${delta}`);
    }

    const current = getPhase(patternName, length);
    let newPhase = current + delta;

    if (typeof modulo === 'number' && modulo > 0) {
      newPhase = ((newPhase % modulo) + modulo) % modulo;
    }

    const phaseKeyBase = activeLayer ? `${activeLayer}:${patternName}` : patternName;
    const phaseKey = `${phaseKeyBase}:${length}`;
    phases.set(phaseKey, newPhase);
  }

  /**
   * Get phase relationship between two patterns
   * Useful for analyzing polyrhythmic interlocking
   * @param {string} patternA - First pattern name
   * @param {number} lengthA - First pattern length
   * @param {string} patternB - Second pattern name
   * @param {number} lengthB - Second pattern length
   * @returns {number} phase difference (B - A)
   */
  function getPhaseRelationship(patternA, lengthA, patternB, lengthB) {
    if (typeof patternA !== 'string' || !patternA || typeof patternB !== 'string' || !patternB) {
      throw new Error('PhaseLockedRhythmGenerator.getPhaseRelationship: pattern names must be non-empty strings');
    }

    if (!Number.isInteger(lengthA) || lengthA <= 0 || !Number.isInteger(lengthB) || lengthB <= 0) {
      throw new Error(`PhaseLockedRhythmGenerator.getPhaseRelationship: lengths must be positive integers (got ${lengthA}, ${lengthB})`);
    }

    const phaseA = getPhase(patternA, lengthA);
    const phaseB = getPhase(patternB, lengthB);
    return phaseB - phaseA;
  }

  /**
   * Clear all tracked phases
   */
  function reset() {
    phases.clear();
    generationHistory.length = 0;
  }

  /**
   * Get generation history (for analysis/debugging)
   * @returns {Array} recent generation records
   */
  function getHistory(limit = 50) {
    return generationHistory.slice(-limit);
  }

  return {
    generate,
    lock,
    getPhase,
    advancePhase,
    getPhaseRelationship,
    reset,
    getHistory,
    setActiveLayer,
    initializePolyrhythmCoupling
  };
})();
