PhaseAwareCadenceWindow = (() => {
  const V = Validator.create('phaseAwareCadenceWindow');
  const MAX_SAMPLES = 24;
  const MIN_CONFIDENCE = 0.45;
  /** @type {Map<string, Array<{ timeMs: number, phaseDiff: number, mode: 'lock'|'drift'|'repel' }>>} */
  const samplesByLayer = new Map();
  /** @type {Map<string, { timeMs: number, phaseDiff: number, mode: 'lock'|'drift'|'repel', confidence: number }>} */
  const latestByLayer = new Map();

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
    V.requireFinite(absTimeMs, 'absTimeMs');
    const row = ensureLayer(layer);

    const phase = RhythmicPhaseLock.measurePhase(absTimeMs, layer) ?? null;

    const snapshot = phase
      ? { timeMs: absTimeMs, phaseDiff: clamp(phase.phaseDiff, 0, 1), mode: phase.mode }
      : { timeMs: absTimeMs, phaseDiff: 0.5, mode: /** @type {'lock'|'drift'|'repel'} */ ('drift') };

    row.push(snapshot);
    if (row.length > MAX_SAMPLES) row.shift();

    const confidence = getConfidence(layer);
    const latest = { timeMs: absTimeMs, phaseDiff: snapshot.phaseDiff, mode: snapshot.mode, confidence };
    latestByLayer.set(layer, latest);
    return { phaseDiff: snapshot.phaseDiff, mode: snapshot.mode, confidence };
  }

  /**
   * @param {string} layer
   * @returns {{ timeMs: number, phaseDiff: number, mode: 'lock'|'drift'|'repel', confidence: number } | null}
   */
  function getLatest(layer) {
    const latest = latestByLayer.get(layer);
    return latest || null;
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
  function shouldAllowCadence(absTimeMs, layer, cadenceSuggested, snapshot) {
    const snap = snapshot || getLatest(layer) || {
      timeMs: absTimeMs,
      phaseDiff: 1,
      mode: /** @type {'lock'|'drift'|'repel'} */ ('drift'),
      confidence: 0
    };
    const allowed = Boolean(cadenceSuggested) && snap.confidence >= MIN_CONFIDENCE && snap.phaseDiff <= 0.3;

    ExplainabilityBus.emit('phase-cadence-window', layer, {
      cadenceSuggested: Boolean(cadenceSuggested),
      confidence: snap.confidence,
      phaseDiff: snap.phaseDiff,
      allowed
    }, absTimeMs);

    return allowed;
  }

  function reset() {
    samplesByLayer.clear();
    latestByLayer.clear();
  }

  return { update, getLatest, getConfidence, shouldAllowCadence, reset };
})();
CrossLayerRegistry.register('PhaseAwareCadenceWindow', PhaseAwareCadenceWindow, ['all', 'section']);
