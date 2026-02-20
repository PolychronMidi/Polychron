PhaseAwareCadenceWindow = (() => {
  const MAX_SAMPLES = 24;
  const MIN_CONFIDENCE = 0.45;
  /** @type {Map<string, Array<{ timeMs: number, phaseDiff: number, mode: 'lock'|'drift'|'repel' }>>} */
  const samplesByLayer = new Map();

  /** @param {string} layer */
  function ensureLayer(layer) {
    if (!samplesByLayer.has(layer)) samplesByLayer.set(layer, []);
    const arr = samplesByLayer.get(layer);
    if (!arr) throw new Error('PhaseAwareCadenceWindow: failed to init layer samples for ' + layer);
    return arr;
  }

  /**
   * @param {number} absTimeMs
   * @param {string} layer
   */
  function update(absTimeMs, layer) {
    if (!Number.isFinite(absTimeMs)) throw new Error('PhaseAwareCadenceWindow.update: absTimeMs must be finite');
    const row = ensureLayer(layer);

    const phase = (typeof RhythmicPhaseLock !== 'undefined' && RhythmicPhaseLock && typeof RhythmicPhaseLock.measurePhase === 'function')
      ? RhythmicPhaseLock.measurePhase(absTimeMs, layer)
      : null;

    const snapshot = phase
      ? { timeMs: absTimeMs, phaseDiff: clamp(phase.phaseDiff, 0, 1), mode: phase.mode }
      : { timeMs: absTimeMs, phaseDiff: 0.5, mode: /** @type {'lock'|'drift'|'repel'} */ ('drift') };

    row.push(snapshot);
    if (row.length > MAX_SAMPLES) row.shift();

    const confidence = getConfidence(layer);
    return { phaseDiff: snapshot.phaseDiff, mode: snapshot.mode, confidence };
  }

  /** @param {string} layer */
  function getConfidence(layer) {
    const row = ensureLayer(layer);
    if (row.length < 4) return 0;

    const recent = row.slice(-6);
    const avg = recent.reduce((sum, s) => sum + s.phaseDiff, 0) / recent.length;
    const first = recent[0].phaseDiff;
    const last = recent[recent.length - 1].phaseDiff;
    const trendTowardLock = clamp(first - last, -1, 1);
    const lockRatio = recent.filter(s => s.mode === 'lock').length / recent.length;

    return clamp((1 - avg) * 0.55 + clamp(trendTowardLock, 0, 1) * 0.25 + lockRatio * 0.2, 0, 1);
  }

  /**
   * @param {number} absTimeMs
   * @param {string} layer
   * @param {boolean} cadenceSuggested
   */
  function shouldAllowCadence(absTimeMs, layer, cadenceSuggested) {
    const snapshot = update(absTimeMs, layer);
    const allowed = Boolean(cadenceSuggested) && snapshot.confidence >= MIN_CONFIDENCE && snapshot.phaseDiff <= 0.3;

    if (typeof ExplainabilityBus !== 'undefined' && ExplainabilityBus && typeof ExplainabilityBus.emit === 'function') {
      ExplainabilityBus.emit('phase-cadence-window', layer, {
        cadenceSuggested: Boolean(cadenceSuggested),
        confidence: snapshot.confidence,
        phaseDiff: snapshot.phaseDiff,
        allowed
      }, absTimeMs);
    }

    return allowed;
  }

  function reset() {
    samplesByLayer.clear();
  }

  return { update, getConfidence, shouldAllowCadence, reset };
})();
