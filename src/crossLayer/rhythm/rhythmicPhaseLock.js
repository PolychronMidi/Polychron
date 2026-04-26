// src/crossLayer/rhythmicPhaseLock.js - Rhythmic phase lock/drift oscillator.
// Measures instantaneous phase relationship between L1 and L2 beat grids.
// When phase difference is small, briefly lock them (quantize onsets to aligned grid).
// When large, repel further. Creates breathing patterns: sync - desync - sync.

moduleLifecycle.declare({
  name: 'rhythmicPhaseLock',
  subsystem: 'crossLayer',
  deps: ['L0', 'validator'],
  lazyDeps: ['emergentMelodicEngine'],
  provides: ['rhythmicPhaseLock'],
  crossLayerScopes: ['all'],
  init: (deps) => {
  const L0 = deps.L0;
  const V = deps.validator.create('rhythmicPhaseLock');
  const CHANNEL = 'beatPhase';
  const PHASE_TOLERANCE_MS = 80;
  const LOCK_THRESHOLD = 0.2;    // phase diff < 20% of beat - lock
  const REPEL_THRESHOLD = 0.6;   // phase diff > 60% of beat - repel
  const LOCK_STRENGTH = 0.7;     // how strongly to quantize toward alignment
  const REPEL_STRENGTH = 0.15;   // how strongly to push apart
  const MIN_LOCK_INTERVAL_SEC = 0.8;

  let cimScale = 0.5;

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  let lastLockSec = -Infinity;
  let lockCount = 0;
  let currentMode = /** @type {'lock'|'drift'|'repel'} */ ('drift'); // 'lock' | 'drift' | 'repel'

  /**
   * Post a beat onset from the active layer into ATG.
   * @param {number} absoluteSeconds - absolute ms of the beat onset
   * @param {string} layer - 'L1' or 'L2'
   * @param {number} spBeatVal - duration of one beat in seconds (spBeat)
   */
  function postBeat(absoluteSeconds, layer, spBeatVal) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.requireFinite(spBeatVal, 'spBeatVal');
    L0.post(CHANNEL, layer, absoluteSeconds, { spBeat: spBeatVal });
  }

  /**
   * Measure the phase relationship between the two layers.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - layer to analyze
   * @returns {{ phaseDiff: number, mode: 'lock'|'drift'|'repel', otherBeatSec: number } | null}
   */
  function measurePhase(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');

    const other = L0.findClosest(
      CHANNEL, absoluteSeconds, (PHASE_TOLERANCE_MS * 10) / 1000, activeLayer
    );
    if (!other || V.optionalFinite(other.spBeat) === undefined) return null;

    const otherTimeSec = other.timeInSeconds;
    // Phase difference as fraction of beat duration (0 = in sync, 0.5 = max opposition)
    const timeDiff = m.abs(otherTimeSec - absoluteSeconds);
    const phaseDiff = (timeDiff % other.spBeat) / other.spBeat;
    const normalizedPhase = phaseDiff > 0.5 ? 1 - phaseDiff : phaseDiff;

    let mode = /** @type {'lock'|'drift'|'repel'} */ ('drift');
    // R59: rising contour widens lock tolerance (layers converge as energy builds);
    // contrary counterpoint narrows it (opposing motion should diverge, not lock).
    const melodicCtxPL = emergentMelodicEngine.getContext();
    const melodicLockDelta = melodicCtxPL
      ? (melodicCtxPL.contourShape === 'rising' ? 0.06 : melodicCtxPL.contourShape === 'falling' ? -0.04 : 0)
        + (melodicCtxPL.counterpoint === 'contrary' ? -0.08 : 0)
      : 0;
    // R72: hotspots coupling -- dense rhythmic burst moments invite phase alignment.
    const rhythmEntryPL = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const hotspotsPL = rhythmEntryPL && Array.isArray(rhythmEntryPL.hotspots) ? rhythmEntryPL.hotspots.length : 0;
    const rhythmHotspotDelta = -(hotspotsPL / 16) * 0.06;
    const effectiveLockThreshold = clamp(LOCK_THRESHOLD * (1.5 - cimScale) + melodicLockDelta + rhythmHotspotDelta, 0.05, 0.40);
    if (normalizedPhase < effectiveLockThreshold) mode = 'lock';
    else if (normalizedPhase > REPEL_THRESHOLD) mode = 'repel';

    currentMode = mode;
    return { phaseDiff: normalizedPhase, mode, otherBeatSec: otherTimeSec };
  }

  /**
   * Apply phase lock/drift/repel to a time position (seconds).
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} originalTime - the time (seconds) where the note would normally go
   * @returns {{ time: number, mode: 'lock'|'drift'|'repel', phaseDiff: number }}
   */
  function applyPhaseLock(absoluteSeconds, activeLayer, originalTime) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.requireFinite(originalTime, 'originalTime');

    const phase = measurePhase(absoluteSeconds, activeLayer);
    if (!phase) return { time: originalTime, mode: 'drift', phaseDiff: 0.5 };

    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(spBeat, 'spBeat');

    const melodicCtxPLApply = emergentMelodicEngine.getContext();
    const melodicLockStr = melodicCtxPLApply
      ? (melodicCtxPLApply.contourShape === 'rising' ? 1.08 : melodicCtxPLApply.contourShape === 'falling' ? 0.90 : 1.0)
      : 1.0;
    const melodicRepelStr = melodicCtxPLApply && melodicCtxPLApply.counterpoint === 'contrary' ? 1.25 : 1.0;

    if (phase.mode === 'lock' && absoluteSeconds - lastLockSec >= MIN_LOCK_INTERVAL_SEC) {
      lastLockSec = absoluteSeconds;
      lockCount++;
      // Quantize: pull toward the other layer's beat grid position (in seconds)
      const otherTimeSec = phase.otherBeatSec;
      const pull = (otherTimeSec - originalTime) * LOCK_STRENGTH * melodicLockStr;
      return { time: originalTime + pull, mode: 'lock', phaseDiff: phase.phaseDiff };
    }

    if (phase.mode === 'repel') {
      // Push away from the other layer's grid (in seconds)
      const otherTimeSec = phase.otherBeatSec;
      const direction = originalTime >= otherTimeSec ? 1 : -1;
      const push = spBeat * REPEL_STRENGTH * melodicRepelStr * phase.phaseDiff * 0.1;
      return { time: originalTime + direction * push, mode: 'repel', phaseDiff: phase.phaseDiff };
    }

    return { time: originalTime, mode: 'drift', phaseDiff: phase.phaseDiff };
  }

  /** @returns {'lock'|'drift'|'repel'} */
  function getMode() { return currentMode; }

  /** @returns {number} */
  function getLockCount() { return lockCount; }

  function reset() {
    lastLockSec = -Infinity;
    lockCount = 0;
    currentMode = 'drift';
  }

  return { postBeat, measurePhase, applyPhaseLock, getMode, getLockCount, setCoordinationScale, reset };
  },
});
