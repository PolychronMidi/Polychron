// src/crossLayer/rhythmicPhaseLock.js - Rhythmic phase lock/drift oscillator.
// Measures instantaneous phase relationship between L1 and L2 beat grids.
// When phase difference is small, briefly lock them (quantize onsets to aligned grid).
// When large, repel further. Creates breathing patterns: sync - desync - sync.

rhythmicPhaseLock = (() => {
  const V = validator.create('rhythmicPhaseLock');
  const CHANNEL = 'beatPhase';
  const PHASE_TOLERANCE_MS = 80;
  const LOCK_THRESHOLD = 0.2;    // phase diff < 20% of beat - lock
  const REPEL_THRESHOLD = 0.6;   // phase diff > 60% of beat - repel
  const LOCK_STRENGTH = 0.7;     // how strongly to quantize toward alignment
  const REPEL_STRENGTH = 0.15;   // how strongly to push apart
  const MIN_LOCK_INTERVAL_MS = 800;

  let lastLockMs = -Infinity;
  let lockCount = 0;
  let currentMode = /** @type {'lock'|'drift'|'repel'} */ ('drift'); // 'lock' | 'drift' | 'repel'

  /**
   * Post a beat onset from the active layer into ATG.
   * @param {number} absTimeMs - absolute ms of the beat onset
   * @param {string} layer - 'L1' or 'L2'
   * @param {number} beatDurationMs - duration of one beat in this layer (ms)
   */
  function postBeat(absTimeMs, layer, beatDurationMs) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.requireFinite(beatDurationMs, 'beatDurationMs');
    L0.post(CHANNEL, layer, absTimeMs / 1000, { beatDurationMs });
  }

  /**
   * Measure the phase relationship between the two layers.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - layer to analyze
   * @returns {{ phaseDiff: number, mode: 'lock'|'drift'|'repel', otherBeatMs: number } | null}
   */
  function measurePhase(absTimeMs, activeLayer) {
    V.requireFinite(absTimeMs, 'absTimeMs');

    const other = L0.findClosest(
      CHANNEL, absTimeMs / 1000, (PHASE_TOLERANCE_MS * 10) / 1000, activeLayer
    );
    if (!other || !Number.isFinite(other.beatDurationMs)) return null;

    const otherTimeMs = other.timeInSeconds * 1000;
    // Phase difference as fraction of beat duration (0 = in sync, 0.5 = max opposition)
    const timeDiff = m.abs(otherTimeMs - absTimeMs);
    const phaseDiff = (timeDiff % other.beatDurationMs) / other.beatDurationMs;
    const normalizedPhase = phaseDiff > 0.5 ? 1 - phaseDiff : phaseDiff;

    let mode = /** @type {'lock'|'drift'|'repel'} */ ('drift');
    if (normalizedPhase < LOCK_THRESHOLD) mode = 'lock';
    else if (normalizedPhase > REPEL_THRESHOLD) mode = 'repel';

    currentMode = mode;
    return { phaseDiff: normalizedPhase, mode, otherBeatMs: otherTimeMs };
  }

  /**
   * Apply phase lock/drift/repel to a time position (seconds).
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} originalTime - the time (seconds) where the note would normally go
   * @returns {{ time: number, mode: 'lock'|'drift'|'repel', phaseDiff: number }}
   */
  function applyPhaseLock(absTimeMs, activeLayer, originalTime) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.requireFinite(originalTime, 'originalTime');

    const phase = measurePhase(absTimeMs, activeLayer);
    if (!phase) return { time: originalTime, mode: 'drift', phaseDiff: 0.5 };

    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(spBeat, 'spBeat');

    if (phase.mode === 'lock' && absTimeMs - lastLockMs >= MIN_LOCK_INTERVAL_MS) {
      lastLockMs = absTimeMs;
      lockCount++;
      // Quantize: pull toward the other layer's beat grid position (in seconds)
      const otherTimeSec = phase.otherBeatMs / 1000;
      const pull = (otherTimeSec - originalTime) * LOCK_STRENGTH;
      return { time: originalTime + pull, mode: 'lock', phaseDiff: phase.phaseDiff };
    }

    if (phase.mode === 'repel') {
      // Push away from the other layer's grid (in seconds)
      const otherTimeSec = phase.otherBeatMs / 1000;
      const direction = originalTime >= otherTimeSec ? 1 : -1;
      const push = spBeat * REPEL_STRENGTH * phase.phaseDiff * 0.1;
      return { time: originalTime + direction * push, mode: 'repel', phaseDiff: phase.phaseDiff };
    }

    return { time: originalTime, mode: 'drift', phaseDiff: phase.phaseDiff };
  }

  /** @returns {'lock'|'drift'|'repel'} */
  function getMode() { return currentMode; }

  /** @returns {number} */
  function getLockCount() { return lockCount; }

  function reset() {
    lastLockMs = -Infinity;
    lockCount = 0;
    currentMode = 'drift';
  }

  return { postBeat, measurePhase, applyPhaseLock, getMode, getLockCount, reset };
})();
crossLayerRegistry.register('rhythmicPhaseLock', rhythmicPhaseLock, ['all']);
