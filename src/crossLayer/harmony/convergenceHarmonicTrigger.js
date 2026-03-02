// src/crossLayer/convergenceHarmonicTrigger.js - Rhythm-harmony causal link.
// When rhythmic convergences happen, this module triggers harmonic changes:
// modal interchange moments, cadence resolutions, or tonic reaffirmations.
// Consumes cadenceAlignment tonicBias/dominantBias (dead-end signals).

convergenceHarmonicTrigger = (() => {
  const V = validator.create('convergenceHarmonicTrigger');
  const MIN_TRIGGER_INTERVAL_MS = 2000;
  const TRIGGER_PROBABILITY = 0.35;
  const EVENTS = eventCatalog.names;

  let lastTriggerMs = -Infinity;
  let triggerCount = 0;
  /** @type {{ type: string, bias: number, absTimeMs: number }[]} */
  const pendingChanges = [];

  /**
   * Called when a convergence event fires (via eventBus or direct invocation).
   * Evaluates whether this convergence should trigger a harmonic change.
   * @param {{ rarity?: number, absTimeMs?: number, layer?: string, alignment?: { tonicBias: number, dominantBias: number, shouldResolve: boolean } | null }} event
   */
  function onConvergence(event) {
    V.assertPlainObject(event, 'onConvergence.event');
    const ev = event;
    const absTimeMs = V.requireFinite(ev.absTimeMs, 'onConvergence.event.absTimeMs');
    const rarity = (typeof ev.rarity === 'undefined')
      ? 0.5
      : clamp(V.requireFinite(ev.rarity, 'onConvergence.event.rarity'), 0, 1);
    const layer = (typeof ev.layer === 'undefined')
      ? 'L1'
      : V.assertNonEmptyString(ev.layer, 'onConvergence.event.layer');

    if (absTimeMs - lastTriggerMs < MIN_TRIGGER_INTERVAL_MS) return;

    // Higher rarity convergences are more likely to trigger harmonic changes
    const triggerChance = TRIGGER_PROBABILITY * (0.5 + rarity * 0.5);
    if (rf() > triggerChance) return;

    // Check trust in convergence system
    const trustScore = V.requireFinite(adaptiveTrustScores.getWeight(trustSystems.names.CONVERGENCE), 'onConvergence.trustScore');
    if (trustScore < 0.2) return; // too low trust to act

    // Determine change type based on cadence alignment state.
    // Use pre-computed alignment from processBeat when available to avoid
    // a redundant cadenceAlignment.applyAlignment call and inconsistent tension.
    let changeType = 'modal-color'; // default: add modal interchange color
    let bias = 0;

    const alignment = (ev.alignment !== undefined) ? ev.alignment : null;
    if (alignment && typeof alignment === 'object') {
      const tonicBias = clamp(V.requireFinite(alignment.tonicBias, 'onConvergence.alignment.tonicBias'), 0, 1);
      const dominantBias = clamp(V.requireFinite(alignment.dominantBias, 'onConvergence.alignment.dominantBias'), 0, 1);

      if (tonicBias > 0.5) {
        changeType = 'tonic-reaffirm';
        bias = tonicBias;
      } else if (dominantBias > 0.5) {
        changeType = 'dominant-push';
        bias = dominantBias;
      }
    }

    // Caller (processBeat) already confirmed convergence via convergenceDetector.wasRecent(300ms),
    // so a 500ms re-check is provably redundant. Skip it.

    lastTriggerMs = absTimeMs;
    triggerCount++;

    pendingChanges.push({ type: changeType, bias: clamp(bias, 0, 1), absTimeMs });

    // No active listeners - emitted for eventCatalog completeness and future extensibility
    eventBus.emit(EVENTS.CONVERGENCE_HARMONIC_TRIGGER, {
      type: changeType,
      bias,
      rarity,
      layer,
      triggerCount,
      absTimeMs
    });
  }

  /**
   * Whether a harmonic change should be triggered at this time.
   * @param {number} absTimeMs
   * @returns {boolean}
   */
  function shouldTriggerChange(absTimeMs) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    return pendingChanges.length > 0 && pendingChanges.some(c => c.absTimeMs <= absTimeMs);
  }

  /**
   * Consume and return all pending triggered changes.
   * @returns {{ type: string, bias: number, absTimeMs: number }[]}
   */
  function getTriggeredChanges() {
    const changes = pendingChanges.splice(0, pendingChanges.length);
    return changes;
  }

  /** @returns {number} */
  function getTriggerCount() { return triggerCount; }

  function reset() {
    lastTriggerMs = -Infinity;
    triggerCount = 0;
    pendingChanges.length = 0;
  }

  return { onConvergence, shouldTriggerChange, getTriggeredChanges, getTriggerCount, reset };
})();
crossLayerRegistry.register('convergenceHarmonicTrigger', convergenceHarmonicTrigger, ['all', 'section']);
