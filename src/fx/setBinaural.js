/**
 * Manages binaural beat pitch shifts and volume crossfades at beat boundaries.
 * L0 channel 'binaural' / layer 'shared' is the single source of truth.
 * Both L1 and L2 consume from it independently, so they always emit the same
 * shift at the same wall-clock second regardless of which layer initiated.
 * @returns {void}
 */
const V = validator.create('setBinaural');

/** Next absolute seconds at which a new binaural shift should be scheduled */
let nextBinauralShiftSec = 0;

/** Per-layer timeInSeconds of the last shared entry this layer consumed (dedup guard) */
const lastConsumedByLayer = {};


setBinaural = () => {
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(L0, 'L0');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const absoluteSeconds = beatStartTime;

  // Emit silence, bends, and volume events at a wall-clock second position.
  // timeInSeconds is a plain numeric seconds value; grandFinale appends the 's'
  // suffix when writing to CSV so csv_maestro converts to ticks per-layer.
  function emitShiftEvents(shiftSyncSec, shiftFlip) {
    const shiftActiveChannels = shiftFlip ? flipBinT2 : flipBinF2;
    const shiftInactiveChannels = shiftFlip ? flipBinF2 : flipBinT2;
    const tickEntry = L0.getLast('tickDuration', { since: shiftSyncSec, windowSeconds: Infinity });
    const oneTickInSeconds = tickEntry ? tickEntry.oneTickInSeconds : 60 / (BPM * PPQ);
    const silenceSyncSec = shiftSyncSec - oneTickInSeconds;

    p(c,
      ...shiftActiveChannels.map(ch => ({ timeInSeconds: silenceSyncSec, type: 'control_c', vals: [ch, 64, 0] })),
      ...shiftActiveChannels.map(ch => ({ timeInSeconds: silenceSyncSec, type: 'control_c', vals: [ch, 123, 0] })),
      ...shiftActiveChannels.map(ch => ({ timeInSeconds: silenceSyncSec, type: 'control_c', vals: [ch, 120, 0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: silenceSyncSec, type: 'control_c', vals: [ch, 64, 0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: silenceSyncSec, type: 'control_c', vals: [ch, 123, 0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: silenceSyncSec, type: 'control_c', vals: [ch, 120, 0] }))
    );

    p(c,
      ...binauralL.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'pitch_bend_c', vals: [ch, (ch === lCH1 || ch === lCH3 || ch === lCH5) ? (shiftFlip ? binauralMinus : binauralPlus) : (shiftFlip ? binauralPlus : binauralMinus)] })),
      ...binauralR.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'pitch_bend_c', vals: [ch, (ch === rCH1 || ch === rCH3 || ch === rCH5) ? (shiftFlip ? binauralPlus : binauralMinus) : (shiftFlip ? binauralMinus : binauralPlus)] }))
    );

    p(c,
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'control_c', vals: [ch, 7, 0] })),
      ...shiftActiveChannels.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'control_c', vals: [ch, 7, velocity] }))
    );
  }

  // -- Schedule a new shared shift if due --
  const shiftDue = firstLoop < 1 || absoluteSeconds >= nextBinauralShiftSec;
  if (shiftDue) {
    const binauralSnap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const binauralRegime = binauralSnap ? binauralSnap.regime : 'exploring';
    const binauralInterval = binauralRegime === 'exploring' ? rf(1.5, 3.0)
      : binauralRegime === 'coherent' ? rf(3.0, 5.0)
      : rf(2.0, 4.0);
    nextBinauralShiftSec = absoluteSeconds + binauralInterval;
    flipBin = !flipBin;
    // Clamp current offset into range before stepping -- instrumentation.js seeds
    // binauralFreqOffset from its own temporary BINAURAL default (0.75-2.25) which
    // runs before conductor/config.js overrides BINAURAL to the real range (e.g. 8-12).
    // Without this clamp, rl() receives currentValue far below minValue, collapses
    // its [newMin, newMax] window to an invalid range, and produces large jumps.
    binauralFreqOffset = clamp(binauralFreqOffset, BINAURAL.min, BINAURAL.max);
    binauralFreqOffset = rl(binauralFreqOffset, -.5, .5, BINAURAL.min, BINAURAL.max, 'f');
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    L0.post('binaural', 'shared', absoluteSeconds, { freqOffset: binauralFreqOffset, flip: flipBin });
  }

  // -- Consume the latest shared shift if not yet consumed by this layer --
  const sharedEntry = L0.getLast('binaural', { layer: 'shared' });
  if (sharedEntry && sharedEntry.timeInSeconds !== lastConsumedByLayer[activeLayer]) {
    lastConsumedByLayer[activeLayer] = sharedEntry.timeInSeconds;
    binauralFreqOffset = V.requireFinite(sharedEntry.freqOffset, 'sharedEntry.freqOffset');
    flipBin = V.assertBoolean(sharedEntry.flip, 'sharedEntry.flip');
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    emitShiftEvents(sharedEntry.timeInSeconds, flipBin);

    if (traceDrain && traceDrain.isEnabled()) {
      traceDrain.recordBinauralShift({
        layer: activeLayer,
        absTimeMs: absoluteSeconds * 1000,
        syncMs: sharedEntry.timeInSeconds * 1000,
        usedCrossLayerShift: activeLayer !== 'L1' || !shiftDue,
        syncDeltaMs: m.abs(absoluteSeconds - sharedEntry.timeInSeconds) * 1000,
        freqOffset: binauralFreqOffset,
        toleranceMs: 0,
        flip: flipBin
      });
    }
  }
};
