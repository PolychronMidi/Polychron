/**
 * Manages binaural beat pitch shifts and volume crossfades at beat boundaries,
 * synced across layers via absoluteTimeGrid using ms-precision timestamps.
 * This should not be a perceptible effect, allNoteOff is used to prevent detune artifacts.
 * @returns {void}
 */
const V = validator.create('setBinaural');

/** Millisecond tolerance for treating two layer shifts as the same event */
const BINAURAL_SYNC_TOLERANCE_MS = 1;

/** Next absolute ms at which a timed binaural shift should fire */
let nextBinauralShiftMs = 0;

/** Per-layer seconds of the last shift this layer consumed (own or cross-layer) */
const lastConsumedByLayer = {};


setBinaural = () => {
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(L0, 'L0');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const otherLayer = activeLayer === 'L1' ? 'L2' : 'L1';
  const absTimeMs = beatStartTime * 1000;

  // Emit silence, bends, and volume events at a wall-clock second position.
  // timeInSeconds is a plain numeric seconds value; grandFinale appends the 's'
  // suffix when writing to CSV so csv_maestro converts to ticks per-layer.
  // Takes the flip value explicitly to avoid reading the shared global flipBin
  // mid-mutation -- both layers share that global and write it independently.
  function emitShiftEvents(shiftSyncSec, shiftFlip) {
    const shiftActiveChannels = shiftFlip ? flipBinT2 : flipBinF2;
    const shiftInactiveChannels = shiftFlip ? flipBinF2 : flipBinT2;

    p(c,
      ...shiftActiveChannels.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'control_c', vals: [ch, 64, 0] })),
      ...shiftActiveChannels.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'control_c', vals: [ch, 123, 0] })),
      ...shiftActiveChannels.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'control_c', vals: [ch, 120, 0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'control_c', vals: [ch, 64, 0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'control_c', vals: [ch, 123, 0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: shiftSyncSec, type: 'control_c', vals: [ch, 120, 0] }))
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

  // Scan L0 for cross-layer binaural entries posted since this layer last consumed.
  const lastConsumed = lastConsumedByLayer[activeLayer] ?? -1;
  const crossEntry = L0.getLast('binaural', { layer: otherLayer, since: lastConsumed, windowSeconds: 10 });

  if (crossEntry) {
    lastConsumedByLayer[activeLayer] = crossEntry.timeInSeconds;
    binauralFreqOffset = V.requireFinite(crossEntry.freqOffset, 'crossLayerShift.freqOffset');
    flipBin = V.assertBoolean(crossEntry.flip, 'crossLayerShift.flip');
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    // Use the initiating layer's exact wall-clock second. csv_maestro converts
    // this to the correct tick in each layer's own time-base, so both files
    // retune at the same playback moment regardless of tempo differences.
    const entrySyncSec = crossEntry.timeInSeconds;
    emitShiftEvents(entrySyncSec, flipBin);

    if (traceDrain && traceDrain.isEnabled()) {
      traceDrain.recordBinauralShift({
        layer: activeLayer,
        absTimeMs,
        syncMs: crossEntry.timeInSeconds * 1000,
        usedCrossLayerShift: true,
        syncDeltaMs: m.abs(absTimeMs - crossEntry.timeInSeconds * 1000),
        freqOffset: binauralFreqOffset,
        toleranceMs: BINAURAL_SYNC_TOLERANCE_MS,
        flip: flipBin
      });
    }
  }

  // Timed initiation: only when no cross-layer shift was just consumed
  if (!crossEntry) {
    const timedShift = absTimeMs >= nextBinauralShiftMs;
    if (firstLoop < 1 || timedShift) {
      // R99 E1: Regime-responsive binaural shift timing.
      // Exploring shifts more frequently (more tonal flux, feeds phase energy),
      // coherent shifts less frequently (stability).
      const binauralSnap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
      const binauralRegime = binauralSnap ? binauralSnap.regime : 'exploring';
      const binauralInterval = binauralRegime === 'exploring' ? rf(1.5, 3.0)
        : binauralRegime === 'coherent' ? rf(3.0, 5.0)
        : rf(2.0, 4.0);
      nextBinauralShiftMs = absTimeMs + binauralInterval * 1000;
      flipBin = !flipBin;
      // Clamp current offset into range before stepping -- instrumentation.js seeds
      // binauralFreqOffset from its own temporary BINAURAL default (0.75-2.25) which
      // runs before conductor/config.js overrides BINAURAL to the real range (e.g. 8-12).
      // Without this clamp, rl() receives currentValue far below minValue, collapses
      // its [newMin, newMax] window to an invalid range, and produces large jumps.
      binauralFreqOffset = clamp(binauralFreqOffset, BINAURAL.min, BINAURAL.max);
      binauralFreqOffset = rl(binauralFreqOffset, -.1, .1, BINAURAL.min, BINAURAL.max, 'f');
      [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
      V.requireFinite(binauralPlus, 'binauralPlus');
      V.requireFinite(binauralMinus, 'binauralMinus');

      const syncSec = absTimeMs / 1000;
      emitShiftEvents(syncSec, flipBin);

      lastConsumedByLayer[activeLayer] = absTimeMs / 1000;

      L0.post('binaural', activeLayer, absTimeMs / 1000, { freqOffset: binauralFreqOffset, flip: flipBin });

      if (traceDrain && traceDrain.isEnabled()) {
        traceDrain.recordBinauralShift({
          layer: activeLayer,
          absTimeMs,
          syncMs: absTimeMs,
          usedCrossLayerShift: false,
          syncDeltaMs: 0,
          freqOffset: binauralFreqOffset,
          toleranceMs: BINAURAL_SYNC_TOLERANCE_MS,
          flip: flipBin
        });
      }
    }
  }
};
