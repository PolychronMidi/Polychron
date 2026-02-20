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
    const ev = (event && typeof event === 'object') ? event : {};
    const absTimeMs = Number.isFinite(ev.absTimeMs) ? Number(ev.absTimeMs) : 0;
    const rarity = Number.isFinite(ev.rarity) ? Number(ev.rarity) : 0.5;

    if (absTimeMs - lastTriggerMs < MIN_TRIGGER_INTERVAL_MS) return;

    // Higher rarity convergences are more likely to trigger harmonic changes
    const triggerChance = TRIGGER_PROBABILITY * (0.5 + rarity * 0.5);
    if (rf() > triggerChance) return;

    // Check trust in convergence system
    const trustScore = (typeof AdaptiveTrustScores !== 'undefined' && AdaptiveTrustScores &&
      typeof AdaptiveTrustScores.getWeight === 'function')
      ? AdaptiveTrustScores.getWeight('convergence')
      : 0.5;
    if (trustScore < 0.2) return; // too low trust to act

    // Determine change type based on cadence alignment state
    let changeType = 'modal-color'; // default: add modal interchange color
    let bias = 0;

    // Consume CadenceAlignment dead-end signals
    if (typeof CadenceAlignment !== 'undefined' && CadenceAlignment &&
        typeof CadenceAlignment.applyAlignment === 'function') {
      const layer = (typeof ev.layer === 'string') ? ev.layer : 'L1';
      const tension = (typeof ConductorState !== 'undefined' && ConductorState &&
        typeof ConductorState.getField === 'function')
        ? clamp(Number(ConductorState.getField('compositeIntensity')) || 0, 0, 1)
        : 0.5;

      // Read cadence alignment state for tonicBias/dominantBias
      const alignment = CadenceAlignment.applyAlignment(absTimeMs, layer, tension);
      if (alignment) {
        const tonicBias = Number.isFinite(alignment.tonicBias) ? alignment.tonicBias : 0;
        const dominantBias = Number.isFinite(alignment.dominantBias) ? alignment.dominantBias : 0;

        if (tonicBias > 0.5) {
          changeType = 'tonic-reaffirm';
          bias = tonicBias;
        } else if (dominantBias > 0.5) {
          changeType = 'dominant-push';
          bias = dominantBias;
        }
      }
    }

    // Was convergence recent? (check both layers)
    const wasRecent = (typeof ConvergenceDetector !== 'undefined' && ConvergenceDetector &&
      typeof ConvergenceDetector.wasRecent === 'function')
      ? ConvergenceDetector.wasRecent(absTimeMs, ev.layer || 'L1', 500)
      : true;

    if (!wasRecent) return;

    lastTriggerMs = absTimeMs;
    triggerCount++;

    pendingChanges.push({ type: changeType, bias: clamp(bias, 0, 1), absTimeMs });

    // Emit harmonic trigger event
    if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') {
      EventBus.emit('CONVERGENCE_HARMONIC_TRIGGER', {
        type: changeType,
        bias,
        rarity,
        triggerCount,
        absTimeMs
      });
    }
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
