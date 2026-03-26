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

/** All initiated shifts, in chronological order. Both layers scan this list. */
const initiatedShifts = [];

/** Per-layer index into initiatedShifts: next entry to scan */
const shiftCursorByLayer = {};


setBinaural = () => {
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(absoluteTimeGrid, 'absoluteTimeGrid');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const absTimeMs = beatStartTime * 1000;

  // Scan the shared shift list for cross-layer entries up to our current time
  const cursor = shiftCursorByLayer[activeLayer] || 0;
  const crossLayerEntries = [];
  let newCursor = cursor;
  for (let i = cursor; i < initiatedShifts.length; i++) {
    const entry = initiatedShifts[i];
    if (entry.layer === activeLayer) { newCursor = i + 1; continue; }
    if (entry.syncMs > absTimeMs + BINAURAL_SYNC_TOLERANCE_MS) break;
    crossLayerEntries.push(entry);
    newCursor = i + 1;
  }
  shiftCursorByLayer[activeLayer] = newCursor;

  // Emit silence, bends, and volume events at a specific sync tick
  function emitShiftEvents(shiftSyncTick) {
    const shiftActiveChannels = flipBin ? flipBinT2 : flipBinF2;
    const shiftInactiveChannels = flipBin ? flipBinF2 : flipBinT2;

    p(c,
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 64, 0] })),
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 123, 0] })),
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 120, 0] }))
    );

    p(c,
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'pitch_bend_c', vals: [ch, binauralL.includes(ch) ? binauralPlus : binauralMinus] }))
    );

    p(c,
      ...shiftInactiveChannels.map(ch => ({ tick: shiftSyncTick, type: 'control_c', vals: [ch, 7, 0] })),
      ...shiftActiveChannels.map(ch => ({ tick: shiftSyncTick + 1, type: 'control_c', vals: [ch, 7, velocity] }))
    );
  }

  // Sync every cross-layer shift at its exact tick
  for (let i = 0; i < crossLayerEntries.length; i++) {
    const entry = crossLayerEntries[i];
    binauralFreqOffset = V.requireFinite(entry.freqOffset, 'crossLayerShift.freqOffset');
    flipBin = V.assertBoolean(entry.flip, 'crossLayerShift.flip');
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    const entrySyncTick = m.max(0, crossLayerHelpers.msToSyncTick(entry.syncMs));
    V.requireFinite(entrySyncTick, 'entrySyncTick');
    emitShiftEvents(entrySyncTick);

    if (traceDrain && traceDrain.isEnabled()) {
      traceDrain.recordBinauralShift({
        layer: activeLayer,
        absTimeMs,
        syncMs: entry.syncMs,
        syncTick: entrySyncTick,
        silenceTick: entrySyncTick,
        usedCrossLayerShift: true,
        syncDeltaMs: m.abs(absTimeMs - entry.syncMs),
        freqOffset: binauralFreqOffset,
        toleranceMs: BINAURAL_SYNC_TOLERANCE_MS,
        flip: flipBin
      });
    }
  }

  // Timed initiation: only when no cross-layer shift was just consumed
  if (crossLayerEntries.length === 0) {
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
      binauralFreqOffset = rl(binauralFreqOffset, -.1, .1, BINAURAL.min, BINAURAL.max, 'f');
      [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
      V.requireFinite(binauralPlus, 'binauralPlus');
      V.requireFinite(binauralMinus, 'binauralMinus');

      const syncTick = m.max(0, crossLayerHelpers.msToSyncTick(absTimeMs));
      V.requireFinite(syncTick, 'syncTick');
      emitShiftEvents(syncTick);

      // Store for cross-layer sync and grid diagnostics
      initiatedShifts.push({ layer: activeLayer, syncMs: absTimeMs, freqOffset: binauralFreqOffset, flip: flipBin });
      absoluteTimeGrid.post('binaural', activeLayer, absTimeMs, {
        freqOffset: binauralFreqOffset,
        flip: flipBin
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
