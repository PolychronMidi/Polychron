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

/**
 * All initiated shifts in chronological order, persisted for cross-layer catch-up.
 * absoluteTimeGrid is point-in-time (+/- tolerance around now) and prunes entries after
 * 4s -- too narrow for binaural intervals up to 5s and beat-boundary latency up to
 * one full beat. This list is the authoritative cross-layer ledger; the grid is used
 * only for the tick-conversion timing context it stores.
 */
const initiatedShifts = [];

/** Per-layer ms of the last shift this layer consumed (own or cross-layer) */
const lastConsumedMsByLayer = {};


setBinaural = () => {
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(absoluteTimeGrid, 'absoluteTimeGrid');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const absTimeMs = beatStartTime * 1000;

  // Emit silence, bends, and volume events at a specific sync tick.
  // Takes the flip value explicitly to avoid reading the shared global flipBin
  // mid-mutation -- both layers share that global and write it independently.
  function emitShiftEvents(shiftSyncTick, shiftFlip) {
    const shiftActiveChannels = shiftFlip ? flipBinT2 : flipBinF2;
    const shiftInactiveChannels = shiftFlip ? flipBinF2 : flipBinT2;

    p(c,
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 64, 0] })),
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 123, 0] })),
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 120, 0] })),
      ...shiftInactiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 64, 0] })),
      ...shiftInactiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 123, 0] })),
      ...shiftInactiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 120, 0] }))
    );

    p(c,
      ...binauralL.map(ch => ({ tick: shiftSyncTick, type: 'pitch_bend_c', vals: [ch, (ch === lCH1 || ch === lCH3 || ch === lCH5) ? (shiftFlip ? binauralMinus : binauralPlus) : (shiftFlip ? binauralPlus : binauralMinus)] })),
      ...binauralR.map(ch => ({ tick: shiftSyncTick, type: 'pitch_bend_c', vals: [ch, (ch === rCH1 || ch === rCH3 || ch === rCH5) ? (shiftFlip ? binauralPlus : binauralMinus) : (shiftFlip ? binauralMinus : binauralPlus)] }))
    );

    p(c,
      ...shiftInactiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 7, 0] })),
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick + 1, type: 'control_c', vals: [ch, 7, velocity] }))
    );
  }

  // Scan initiatedShifts for cross-layer entries posted since this layer last consumed.
  // Uses wall-clock ms range (lastConsumed to now) rather than a cursor index, so there
  // is no beat-boundary latency -- any shift posted by the other layer up to this beat
  // is caught immediately on the first beat that arrives after it.
  const lastConsumed = lastConsumedMsByLayer[activeLayer] ?? -1;
  let crossEntry = null;
  for (let i = initiatedShifts.length - 1; i >= 0; i--) {
    const entry = initiatedShifts[i];
    if (entry.layer === activeLayer) continue;
    if (entry.syncMs <= lastConsumed) break;
    if (entry.syncMs <= absTimeMs + BINAURAL_SYNC_TOLERANCE_MS) {
      crossEntry = entry;
      break;
    }
  }

  if (crossEntry) {
    lastConsumedMsByLayer[activeLayer] = crossEntry.syncMs;
    binauralFreqOffset = V.requireFinite(crossEntry.freqOffset, 'crossLayerShift.freqOffset');
    flipBin = V.assertBoolean(crossEntry.flip, 'crossLayerShift.flip');
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    // Emit at the consuming layer's current beat tick. Reconstructing the initiating
    // layer's past tick and writing events there places them outside this layer's
    // timeline, extending the rendered track length with trailing pitch bend events.
    const entrySyncTick = m.max(0, beatStart);
    V.requireFinite(entrySyncTick, 'entrySyncTick');
    emitShiftEvents(entrySyncTick, flipBin);

    if (traceDrain && traceDrain.isEnabled()) {
      traceDrain.recordBinauralShift({
        layer: activeLayer,
        absTimeMs,
        syncMs: crossEntry.syncMs,
        syncTick: entrySyncTick,
        silenceTick: entrySyncTick,
        usedCrossLayerShift: true,
        syncDeltaMs: m.abs(absTimeMs - crossEntry.syncMs),
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

      const syncTick = m.max(0, crossLayerHelpers.msToSyncTick(absTimeMs));
      V.requireFinite(syncTick, 'syncTick');
      emitShiftEvents(syncTick, flipBin);

      lastConsumedMsByLayer[activeLayer] = absTimeMs;

      initiatedShifts.push({ layer: activeLayer, syncMs: absTimeMs, freqOffset: binauralFreqOffset, flip: flipBin });
      absoluteTimeGrid.post('binaural', activeLayer, absTimeMs, {
        freqOffset: binauralFreqOffset,
        flip: flipBin,
      });

      if (traceDrain && traceDrain.isEnabled()) {
        traceDrain.recordBinauralShift({
          layer: activeLayer,
          absTimeMs,
          syncMs: absTimeMs,
          syncTick,
          silenceTick: syncTick,
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
