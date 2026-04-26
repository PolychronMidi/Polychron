moduleLifecycle.declare({
  name: 'phaseAwareCadenceWindow',
  subsystem: 'crossLayer',
  deps: ['validator'],
  provides: ['phaseAwareCadenceWindow'],
  crossLayerScopes: ['all', 'section'],
  init: (deps) => {
  const V = deps.validator.create('phaseAwareCadenceWindow');
  const MAX_SAMPLES = 24;
  const MIN_CONFIDENCE = 0.45;
  /** @type {Map<string, Array<{ timeInSeconds: number, phaseDiff: number, mode: 'lock'|'drift'|'repel' }>>} */
  const samplesByLayer = new Map();
  /** @type {Map<string, { timeInSeconds: number, phaseDiff: number, mode: 'lock'|'drift'|'repel', confidence: number }>} */
  const latestByLayer = new Map();

  /** @param {string} layer */
  function ensureLayer(layer) {
    if (!samplesByLayer.has(layer)) samplesByLayer.set(layer, []);
    const arr = samplesByLayer.get(layer);
    if (!arr) throw new Error('phaseAwareCadenceWindow: failed to init layer samples for ' + layer);
    return arr;
  }

  /**
   * @param {number} absoluteSeconds
   * @param {string} layer
   */
  function update(absoluteSeconds, layer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    const row = ensureLayer(layer);

    const phase = rhythmicPhaseLock.measurePhase(absoluteSeconds, layer) ?? null;

    const snapshot = phase
      ? { timeInSeconds: absoluteSeconds, phaseDiff: clamp(phase.phaseDiff, 0, 1), mode: phase.mode }
      : { timeInSeconds: absoluteSeconds, phaseDiff: 0.5, mode: /** @type {'lock'|'drift'|'repel'} */ ('drift') };

    row.push(snapshot);
    if (row.length > MAX_SAMPLES) row.shift();

    const confidence = getConfidence(layer);
    const latest = { timeInSeconds: absoluteSeconds, phaseDiff: snapshot.phaseDiff, mode: snapshot.mode, confidence };
    latestByLayer.set(layer, latest);
    return { phaseDiff: snapshot.phaseDiff, mode: snapshot.mode, confidence };
  }

  /**
   * @param {string} layer
   * @returns {{ timeInSeconds: number, phaseDiff: number, mode: 'lock'|'drift'|'repel', confidence: number } | null}
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
   * @param {number} absoluteSeconds
   * @param {string} layer
   * @param {boolean} cadenceSuggested
   */
  function shouldAllowCadence(absoluteSeconds, layer, cadenceSuggested, snapshot) {
    const snap = snapshot || getLatest(layer) || {
      timeInSeconds: absoluteSeconds,
      phaseDiff: 1,
      mode: /** @type {'lock'|'drift'|'repel'} */ ('drift'),
      confidence: 0
    };
    const intent = sectionIntentCurves.getLastIntent();
    const ct = V.optionalFinite(intent.convergenceTarget, 0.5);
    // Melodic coupling: directionBias shifts the phase threshold.
    // Ascending contour (building) -> narrow window -> resist premature cadence.
    // Descending contour (resolving) -> widen window -> welcome cadence.
    const melodicCtxPACW = emergentMelodicEngine.getContext();
    const dirBias = melodicCtxPACW ? V.optionalFinite(melodicCtxPACW.directionBias, 0) : 0;
    // Rhythmic coupling: complex emergent rhythm creates natural cadence windows even with phase divergence.
    const rhythmEntryPACW = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const rhythmComplexityPACW = rhythmEntryPACW && Number.isFinite(rhythmEntryPACW.complexity) ? rhythmEntryPACW.complexity : 0;
    // R82 E2: registerMigrationDir bridge -- ascending migration compresses cadence window
    // (resist premature resolution while pitch center climbs). Counterpart: crossLayerSilhouette
    // TIGHTENS form tracking under same signal (ascending = structural firmness + cadence resistance).
    const registerMigDirPACW = melodicCtxPACW
      ? (melodicCtxPACW.registerMigrationDir === 'ascending' ? -0.05 : melodicCtxPACW.registerMigrationDir === 'descending' ? 0.04 : 0)
      : 0;
    // R90 E3: freshnessEma antagonism bridge with harmonicIntervalGuard -- sustained melodic novelty
    // compresses cadence window (novel territory = resolution deferred, don't rush to cadence).
    // Counterpart: harmonicIntervalGuard NARROWS deadband under same signal (harmonic control tightens).
    const freshnessEmaPACW = melodicCtxPACW ? V.optionalFinite(melodicCtxPACW.freshnessEma, 0.5) : 0.5;
    const freshnessEmaPACWMod = clamp((freshnessEmaPACW - 0.45) * (-0.08), -0.04, 0.02); // novel->compress window
    // R92 E1: contourShape antagonism bridge with harmonicIntervalGuard -- rising contour compresses
    // cadence window (ascending phrase = defer resolution, sustain the climb). Falling opens window
    // (descending phrase naturally resolves; let cadence land). Counterpart: harmonicIntervalGuard
    // WIDENS deadband during rising and NARROWS during falling.
    const contourShapePACW = melodicCtxPACW ? melodicCtxPACW.contourShape : null;
    const contourShapePACWMod = contourShapePACW === 'rising' ? -0.03 : contourShapePACW === 'falling' ? 0.03 : 0;
    const phaseDiffThreshold = clamp(0.3 + ct * 0.15 - dirBias * 0.06 + rhythmComplexityPACW * 0.06 + registerMigDirPACW + freshnessEmaPACWMod + contourShapePACWMod, 0.15, 0.55);
    const allowed = Boolean(cadenceSuggested) && snap.confidence >= MIN_CONFIDENCE && snap.phaseDiff <= phaseDiffThreshold;

    explainabilityBus.emit('phase-cadence-window', layer, {
      cadenceSuggested: Boolean(cadenceSuggested),
      confidence: snap.confidence,
      phaseDiff: snap.phaseDiff,
      allowed
    }, absoluteSeconds);

    return allowed;
  }

  function reset() {
    samplesByLayer.clear();
    latestByLayer.clear();
  }

  return { update, getLatest, getConfidence, shouldAllowCadence, reset };
  },
});
