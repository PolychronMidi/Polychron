// src/conductor/LayerEntryExitTracker.js - Layer entry/exit orchestration tracker.
// Detects when polyrhythmic layers enter or exit activity (additive vs.
// subtractive orchestration). Signals orchestration momentum direction.
// Pure query API — consumed via ConductorState.

LayerEntryExitTracker = (() => {
  const V = Validator.create('LayerEntryExitTracker');
  const MAX_SNAPSHOTS = 16;
  /** @type {Array<{ layerCount: number, time: number }>} */
  const snapshots = [];

  /**
   * Record a snapshot of active layer count.
   * @param {number} absTime
   */
  function recordSnapshot(absTime) {
    V.requireFinite(absTime, 'absTime');

    const entries = AbsoluteTimeWindow.getEntries(2);

    // Count distinct active layers in recent window
    /** @type {Object.<string, boolean>} */
    const seen = {};
    let count = 0;
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i]) continue;
      const layer = String(entries[i].layer || 'default');
      if (!seen[layer]) {
        seen[layer] = true;
        count++;
      }
    }

    snapshots.push({ layerCount: count, time: absTime });
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
  }

  /**
   * Analyze orchestration momentum.
   * @returns {{ momentum: string, layerDelta: number, currentLayers: number }}
   */
  function getMomentumSignal() {
    if (snapshots.length < 3) {
      return { momentum: 'stable', layerDelta: 0, currentLayers: 0 };
    }

    const current = snapshots[snapshots.length - 1].layerCount;
    const older = snapshots[m.max(0, snapshots.length - 4)].layerCount;
    const delta = current - older;

    let momentum = 'stable';
    if (delta > 1) momentum = 'additive'; // voices entering
    else if (delta < -1) momentum = 'subtractive'; // voices exiting
    else if (delta === 1) momentum = 'growing';
    else if (delta === -1) momentum = 'thinning';

    return { momentum, layerDelta: delta, currentLayers: current };
  }

  /** Reset tracking. */
  function reset() {
    snapshots.length = 0;
  }

  ConductorIntelligence.registerRecorder('LayerEntryExitTracker', (ctx) => { LayerEntryExitTracker.recordSnapshot(ctx.absTime); });
  ConductorIntelligence.registerStateProvider('LayerEntryExitTracker', () => {
    const s = LayerEntryExitTracker.getMomentumSignal();
    return { layerMomentum: s ? s.momentum : 'stable', layerCount: s ? s.currentLayers : 0 };
  });
  ConductorIntelligence.registerModule('LayerEntryExitTracker', { reset }, ['section']);

  return {
    recordSnapshot,
    getMomentumSignal,
    reset
  };
})();
