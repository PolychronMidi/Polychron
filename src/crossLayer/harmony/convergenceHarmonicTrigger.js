// src/crossLayer/harmony/convergenceHarmonicTrigger.js - Rhythm-harmony causal link.
// When rhythmic convergences happen, this module triggers harmonic changes:
// modal interchange moments, cadence resolutions, or tonic reaffirmations.
// Consumes cadenceAlignment tonicBias/dominantBias (dead-end signals).

moduleLifecycle.declare({
  name: 'convergenceHarmonicTrigger',
  subsystem: 'crossLayer',
  deps: ['L0', 'eventBus', 'validator'],
  lazyDeps: ['adaptiveTrustScores', 'emergentMelodicEngine'],
  provides: ['convergenceHarmonicTrigger'],
  crossLayerScopes: ['all', 'section'],
  init: (deps) => {
  const eventBus = deps.eventBus;
  const L0 = deps.L0;
  const V = deps.validator.create('convergenceHarmonicTrigger');
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
    const rhythmEntryRHT = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const rhythmBiasRHT = rhythmEntryRHT && Number.isFinite(rhythmEntryRHT.biasStrength) ? rhythmEntryRHT.biasStrength : 0;
    // Single call to emergentMelodicEngine.getContext() reused throughout onConvergence.
    const melodicCtxCHT = emergentMelodicEngine.getContext();
    const ascendRatioCHT = melodicCtxCHT ? V.optionalFinite(melodicCtxCHT.ascendRatio, 0.5) : 0.5;
    const ascendTriggerBoost = 1.0 + clamp((ascendRatioCHT - 0.45) * 0.25, -0.05, 0.12);
    const triggerChance = TRIGGER_PROBABILITY * (0.5 + rarity * 0.5) * (1.0 + rhythmBiasRHT * 0.25) * ascendTriggerBoost;
    if (rf() > triggerChance) return;

    // Check trust in convergence system
    const trustScore = V.requireFinite(adaptiveTrustScores.getWeight(trustSystems.names.CONVERGENCE), 'onConvergence.trustScore');
    if (trustScore < 0.2) return; // too low trust to act

    // Determine change type based on cadence alignment state.
    let changeType = 'modal-color'; // default: add modal interchange color
    let bias = 0;

    const dirBias = melodicCtxCHT ? V.optionalFinite(melodicCtxCHT.directionBias, 0) : 0;

    const alignment = (ev.alignment !== undefined) ? ev.alignment : null;
    if (!alignment && melodicCtxCHT) {
      if (dirBias > 0.3) { changeType = 'dominant-push'; bias = clamp(dirBias, 0, 1); }
      else if (dirBias < -0.3) { changeType = 'tonic-reaffirm'; bias = clamp(-dirBias, 0, 1); }
    }
    const hfEntryCHT = L0.getLast(L0_CHANNELS.harmonicFunction, { layer: 'both' });
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

    // so a 500ms re-check is provably redundant. Skip it.

    lastTriggerSec = absoluteSeconds;
    triggerCount++;

    pendingChanges.push({ type: changeType, bias: clamp(bias, 0, 1), absoluteSeconds });

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
  },
});
