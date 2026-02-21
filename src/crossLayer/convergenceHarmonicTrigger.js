// src/crossLayer/convergenceHarmonicTrigger.js — Rhythm→harmony causal link.
// When rhythmic convergences happen, this module triggers harmonic changes:
// modal interchange moments, cadence resolutions, or tonic reaffirmations.
// Consumes CadenceAlignment tonicBias/dominantBias (dead-end signals).

ConvergenceHarmonicTrigger = (() => {
  const V = Validator.create('ConvergenceHarmonicTrigger');
  const MIN_TRIGGER_INTERVAL_MS = 2000;
  const TRIGGER_PROBABILITY = 0.35;

  let lastTriggerMs = -Infinity;
  let triggerCount = 0;
  /** @type {{ type: string, bias: number, absTimeMs: number }[]} */
  const pendingChanges = [];

  /**
   * Called when a convergence event fires (via EventBus or direct invocation).
   * Evaluates whether this convergence should trigger a harmonic change.
   * @param {{ rarity?: number, absTimeMs?: number, layer?: string }} event
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
    if (!AdaptiveTrustScores ||
        typeof AdaptiveTrustScores.getWeight !== 'function') {
      throw new Error('ConvergenceHarmonicTrigger.onConvergence: AdaptiveTrustScores.getWeight is required');
    }
    const trustScore = V.requireFinite(AdaptiveTrustScores.getWeight('convergence'), 'onConvergence.trustScore');
    if (trustScore < 0.2) return; // too low trust to act

    // Determine change type based on cadence alignment state
    let changeType = 'modal-color'; // default: add modal interchange color
    let bias = 0;

    // Consume CadenceAlignment dead-end signals
    if (!CadenceAlignment ||
        !CadenceAlignment.applyAlignment) {
      throw new Error('ConvergenceHarmonicTrigger.onConvergence: CadenceAlignment.applyAlignment is required');
    }
    if (!ConductorState ||
        !ConductorState.getField) {
      throw new Error('ConvergenceHarmonicTrigger.onConvergence: ConductorState.getField is required');
    }

    const tension = clamp(V.requireFinite(ConductorState.getField('compositeIntensity'), 'onConvergence.tension'), 0, 1);

    // Read cadence alignment state for tonicBias/dominantBias
    const alignment = CadenceAlignment.applyAlignment(absTimeMs, layer, tension);
    if (alignment !== null && typeof alignment !== 'object') {
      throw new Error('ConvergenceHarmonicTrigger.onConvergence: CadenceAlignment.applyAlignment must return object|null');
    }
    if (alignment) {
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

    // Was convergence recent? (check both layers)
    if (!ConvergenceDetector ||
        typeof ConvergenceDetector.wasRecent !== 'function') {
      throw new Error('ConvergenceHarmonicTrigger.onConvergence: ConvergenceDetector.wasRecent is required');
    }
    const wasRecent = ConvergenceDetector.wasRecent(absTimeMs, layer, 500);

    if (!wasRecent) return;

    lastTriggerMs = absTimeMs;
    triggerCount++;

    pendingChanges.push({ type: changeType, bias: clamp(bias, 0, 1), absTimeMs });

    // Emit harmonic trigger event
    EventBus.emit(EventCatalog.names.CONVERGENCE_HARMONIC_TRIGGER, {
      type: changeType,
      bias,
      rarity,
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
CrossLayerRegistry.register('ConvergenceHarmonicTrigger', ConvergenceHarmonicTrigger, ['all', 'section']);
