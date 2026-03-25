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


setBinaural = () => {
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(absoluteTimeGrid, 'absoluteTimeGrid');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const absTimeMs = beatStartTime * 1000;

  // Check the grid first - if the other layer already shifted, we must follow
  const crossLayerShift = absoluteTimeGrid.findClosest(
    'binaural', absTimeMs, BINAURAL_SYNC_TOLERANCE_MS, activeLayer
  );

  // Derive the sync ms: either the other layer's exact timestamp or our own
  const syncMs = crossLayerShift ? crossLayerShift.timeMs : absTimeMs;

  // Convert ms sync point using the shared timing anchor to avoid end-of-track drift.
  const syncTick = m.max(0, crossLayerHelpers.msToSyncTick(syncMs));
  V.requireFinite(syncTick, 'syncTick');

  const restoreTick = syncTick + 1;
  const activeChannels = flipBin ? flipBinT2 : flipBinF2;
  const inactiveChannels = flipBin ? flipBinF2 : flipBinT2;

  function setBinauralBuildRetuneSilenceEvents() {
    return {
      events: [
        // Cut sustain and sounding notes on the exact retune tick before bend events are serialized.
        ...activeChannels.map(ch => ({ tick: syncTick, type: 'control_c', vals: [ch, 64, 0] })),
        ...activeChannels.map(ch => ({ tick: syncTick, type: 'control_c', vals: [ch, 123, 0] })),
        ...activeChannels.map(ch => ({ tick: syncTick, type: 'control_c', vals: [ch, 120, 0] }))
      ]
    };
  }

  const timedShift = absTimeMs >= nextBinauralShiftMs;
  const shouldShift = firstLoop < 1 || timedShift || crossLayerShift;

  if (shouldShift) {

    // Only the initiating layer advances the shared timer
    if (!crossLayerShift) {
      nextBinauralShiftMs = absTimeMs + rf(2, 4) * 1000;
    }

    const retuneSilence = setBinauralBuildRetuneSilenceEvents();
    p(c, ...retuneSilence.events);

    if (crossLayerShift) {
      // Sync: adopt the offset and flip state from the other layer's shift
      binauralFreqOffset = V.requireFinite(crossLayerShift.freqOffset, 'crossLayerShift.freqOffset');
      flipBin = V.assertBoolean(crossLayerShift.flip, 'crossLayerShift.flip');
    } else {
      // New shift: flip and compute a fresh offset
      flipBin = !flipBin;
      binauralFreqOffset = rl(binauralFreqOffset, -.1, .1, BINAURAL.min, BINAURAL.max);
    }

    // Recompute pitch bend values from updated offset - stale values cause audible detune
    [binauralPlus, binauralMinus] = [1, -1].map(binauralOffset);
    V.requireFinite(binauralPlus, 'binauralPlus');
    V.requireFinite(binauralMinus, 'binauralMinus');

    // Post this shift to the grid for cross-layer coordination
    absoluteTimeGrid.post('binaural', activeLayer, syncMs, {
      freqOffset: binauralFreqOffset,
      flip: flipBin
    });
    if (traceDrain && traceDrain.isEnabled()) {
      traceDrain.recordBinauralShift({
        layer: activeLayer,
        absTimeMs,
        syncMs,
        syncTick,
        silenceTick: retuneSilence.silenceTick,
        usedCrossLayerShift: Boolean(crossLayerShift),
        syncDeltaMs: crossLayerShift ? m.abs(absTimeMs - syncMs) : 0,
        freqOffset: binauralFreqOffset,
        toleranceMs: BINAURAL_SYNC_TOLERANCE_MS,
        flip: flipBin
      });
    }

    p(c,
      ...binauralL.map(ch => ({ tick: syncTick, type: 'pitch_bend_c', vals: [ch, ch === lCH1 || ch === lCH3 || ch === lCH5 ? (flipBin ? binauralMinus : binauralPlus) : (flipBin ? binauralPlus : binauralMinus)] })),
      ...binauralR.map(ch => ({ tick: syncTick, type: 'pitch_bend_c', vals: [ch, ch === rCH1 || ch === rCH3 || ch === rCH5 ? (flipBin ? binauralPlus : binauralMinus) : (flipBin ? binauralMinus : binauralPlus)] }))
    );

    p(c,
      ...inactiveChannels.map(ch => ({ tick: syncTick, type: 'control_c', vals: [ch, 7, 0] })),
      ...activeChannels.map(ch => ({ tick: restoreTick, type: 'control_c', vals: [ch, 7, velocity] }))
    );
  }
};
