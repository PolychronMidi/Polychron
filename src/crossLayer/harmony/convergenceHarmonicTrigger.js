// src/crossLayer/convergenceHarmonicTrigger.js - Rhythm-harmony causal link.
// When rhythmic convergences happen, this module triggers harmonic changes:
// modal interchange moments, cadence resolutions, or tonic reaffirmations.
// Consumes cadenceAlignment tonicBias/dominantBias (dead-end signals).

convergenceHarmonicTrigger = (() => {
  const V = validator.create('convergenceHarmonicTrigger');
  const MIN_TRIGGER_INTERVAL_SEC = 2;
  const TRIGGER_PROBABILITY = 0.35;
  const EVENTS = eventCatalog.names;

  let lastTriggerSec = -Infinity;
  let triggerCount = 0;
  /** @type {{ type: string, bias: number, absoluteSeconds: number }[]} */
  const pendingChanges = [];

  /**
   * Called when a convergence event fires (via eventBus or direct invocation).
   * Evaluates whether this convergence should trigger a harmonic change.
   * @param {{ rarity?: number, absoluteSeconds?: number, layer?: string, alignment?: { tonicBias: number, dominantBias: number, shouldResolve: boolean } | null }} event
   */
  function onConvergence(event) {
    V.assertPlainObject(event, 'onConvergence.event');
    const ev = event;
    const absoluteSeconds = V.requireFinite(ev.absoluteSeconds, 'onConvergence.event.absoluteSeconds');
    const rarity = (typeof ev.rarity === 'undefined')
      ? 0.5
      : clamp(V.requireFinite(ev.rarity, 'onConvergence.event.rarity'), 0, 1);
    const layer = (typeof ev.layer === 'undefined')
      ? 'L1'
      : V.assertNonEmptyString(ev.layer, 'onConvergence.event.layer');

    if (absoluteSeconds - lastTriggerSec < MIN_TRIGGER_INTERVAL_SEC) return;

    // Higher rarity convergences are more likely to trigger harmonic changes.
    // Rhythmic coupling: strong rhythmic bias at convergence -> more harmonic change triggers.
    const rhythmEntryRHT = L0.getLast('emergentRhythm', { layer: 'both' });
    const rhythmBiasRHT = rhythmEntryRHT && Number.isFinite(rhythmEntryRHT.biasStrength) ? rhythmEntryRHT.biasStrength : 0;
    const triggerChance = TRIGGER_PROBABILITY * (0.5 + rarity * 0.5) * (1.0 + rhythmBiasRHT * 0.25);
    if (rf() > triggerChance) return;

    // Check trust in convergence system
    const trustScore = V.requireFinite(adaptiveTrustScores.getWeight(trustSystems.names.CONVERGENCE), 'onConvergence.trustScore');
    if (trustScore < 0.2) return; // too low trust to act

    // Determine change type based on cadence alignment state.
    // Use pre-computed alignment from processBeat when available to avoid
    // a redundant cadenceAlignment.applyAlignment call and inconsistent tension.
    let changeType = 'modal-color'; // default: add modal interchange color
    let bias = 0;

    // Melodic coupling: directionBias primes the change type when no explicit alignment is available.
    // Ascending melody at convergence -> dominant-push (amplify the build).
    // Descending melody at convergence -> tonic-reaffirm (invite resolution).
    const melodicCtxCHT = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const dirBias = melodicCtxCHT ? V.optionalFinite(melodicCtxCHT.directionBias, 0) : 0;

    const alignment = (ev.alignment !== undefined) ? ev.alignment : null;
    if (!alignment && melodicCtxCHT) {
      if (dirBias > 0.3) { changeType = 'dominant-push'; bias = clamp(dirBias, 0, 1); }
      else if (dirBias < -0.3) { changeType = 'tonic-reaffirm'; bias = clamp(-dirBias, 0, 1); }
    }
    // Harmonic function coupling: when alignment absent and melodic direction is indeterminate,
    // use current harmonic function to prime change type.
    // D (dominant) at convergence -> resolve to tonic; T (tonic) -> push toward dominant.
    const hfEntryCHT = L0.getLast('harmonicFunction', { layer: 'both' });
    const hfnCHT = hfEntryCHT ? hfEntryCHT.fn : null;
    if (!alignment && hfnCHT && changeType === 'modal-color') {
      if (hfnCHT === 'D') { changeType = 'tonic-reaffirm'; bias = 0.40; }
      else if (hfnCHT === 'T') { changeType = 'dominant-push'; bias = 0.35; }
    }
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

    lastTriggerSec = absoluteSeconds;
    triggerCount++;

    pendingChanges.push({ type: changeType, bias: clamp(bias, 0, 1), absoluteSeconds });

    // No active listeners - emitted for eventCatalog completeness and future extensibility
    eventBus.emit(EVENTS.CONVERGENCE_HARMONIC_TRIGGER, {
      type: changeType,
      bias,
      rarity,
      layer,
      triggerCount,
      absoluteSeconds
    });
  }

  /**
   * Whether a harmonic change should be triggered at this time.
   * @param {number} absoluteSeconds
   * @returns {boolean}
   */
  function shouldTriggerChange(absoluteSeconds) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    return pendingChanges.length > 0 && pendingChanges.some(c => c.absoluteSeconds <= absoluteSeconds);
  }

  /**
   * Consume and return all pending triggered changes.
   * @returns {{ type: string, bias: number, absoluteSeconds: number }[]}
   */
  function getTriggeredChanges() {
    const changes = pendingChanges.splice(0, pendingChanges.length);
    return changes;
  }

  /** @returns {number} */
  function getTriggerCount() { return triggerCount; }

  function reset() {
    lastTriggerSec = -Infinity;
    triggerCount = 0;
    pendingChanges.length = 0;
  }

  return { onConvergence, shouldTriggerChange, getTriggeredChanges, getTriggerCount, reset };
})();
crossLayerRegistry.register('convergenceHarmonicTrigger', convergenceHarmonicTrigger, ['all', 'section']);
