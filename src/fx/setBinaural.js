/**
 * Manages binaural beat pitch shifts and volume crossfades at beat boundaries,
 * synced across layers via absoluteTimeGrid using ms-precision timestamps.
 * This should not be a perceptible effect, allNoteOff is used to prevent detune artifacts.
 * @returns {void}
 */
const V = validator.create('setBinaural');

/** Millisecond tolerance for treating two layer shifts as the same event */
const BINAURAL_SYNC_TOLERANCE_MS = 1;

/** Next absolute ms at which a timed binaural shift should fire, per layer */
const nextBinauralShiftMsByLayer = { L1: 0, L2: 0 };

function setBinauralBuildRetuneSilenceEvents(syncTick) {
  const silenceTick = m.max(0, syncTick);
  const pitchedChannels = allCHs.filter(ch => ch !== drumCH);
  return {
    silenceTick,
    events: [
      // Cut sustain and sounding notes on the exact retune tick before bend events are serialized.
      ...pitchedChannels.map(ch => ({ tick: silenceTick, type: 'control_c', vals: [ch, 64, 0] })),
      ...pitchedChannels.map(ch => ({ tick: silenceTick, type: 'control_c', vals: [ch, 123, 0] })),
      ...pitchedChannels.map(ch => ({ tick: silenceTick, type: 'control_c', vals: [ch, 120, 0] }))
    ]
  };
}

function setBinauralBuildInactiveHoldEvents(startTick, endTick, channels) {
  const holdStartTick = m.max(0, m.round(startTick));
  const holdEndTick = m.max(holdStartTick, m.round(endTick));
  const holdStep = m.max(1, m.round(tpSec * 0.5));
  const events = [];
  for (let tick = holdStartTick; tick <= holdEndTick; tick += holdStep) {
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      events.push({ tick, type: 'control_c', vals: [channels[channelIndex], 7, 0] });
    }
  }
  if ((holdEndTick - holdStartTick) % holdStep !== 0) {
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      events.push({ tick: holdEndTick, type: 'control_c', vals: [channels[channelIndex], 7, 0] });
    }
  }
  return events;
}

function setBinauralResolveRestoreVolume() {
  return velocity;
}

setBinaural = () => {
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(absoluteTimeGrid, 'absoluteTimeGrid');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const absTimeMs = beatStartTime * 1000;

  const timedShift = absTimeMs >= nextBinauralShiftMsByLayer[activeLayer];
  const shouldShift = firstLoop < 1 || timedShift;

  if (shouldShift) {
    beatCount = 0;
    nextBinauralShiftMsByLayer[activeLayer] = absTimeMs + rf(2.5, 5.5) * 1000;

    // Cross-layer ms-precision sync via absoluteTimeGrid
    const crossLayerShift = absoluteTimeGrid.findClosest(
      'binaural', absTimeMs, BINAURAL_SYNC_TOLERANCE_MS, activeLayer
    );

    // Derive the sync ms: either the other layer's exact timestamp or our own
    const syncMs = crossLayerShift ? crossLayerShift.timeMs : absTimeMs;

    // Convert ms sync point using the shared timing anchor to avoid end-of-track drift.
    const syncTick = crossLayerHelpers.msToSyncTick(syncMs);
    V.requireFinite(syncTick, 'syncTick');

    const retuneSilence = setBinauralBuildRetuneSilenceEvents(syncTick);
    p(c, ...retuneSilence.events);

    if (crossLayerShift) {
      // Sync: adopt the offset and flip state from the other layer's shift
      binauralFreqOffset = V.requireFinite(crossLayerShift.freqOffset, 'crossLayerShift.freqOffset');
      flipBin = V.assertBoolean(crossLayerShift.flip, 'crossLayerShift.flip');
    } else {
      // New shift: flip and compute a fresh offset
      flipBin = !flipBin;
      binauralFreqOffset = rl(binauralFreqOffset, -.5, .5, BINAURAL.min, BINAURAL.max);
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

    const restoreTick = syncTick + 1;
    const nextShiftTick = m.max(restoreTick, crossLayerHelpers.msToSyncTick(nextBinauralShiftMsByLayer[activeLayer]));
    const activeChannels = flipBin ? flipBinT2 : flipBinF2;
    const inactiveChannels = flipBin ? flipBinF2 : flipBinT2;
    const muteChannels = Array.from(new Set([...flipBinF2, ...flipBinT2]));
    const inactiveHoldEvents = setBinauralBuildInactiveHoldEvents(restoreTick, nextShiftTick, inactiveChannels);
    p(c,
      ...muteChannels.map(ch => ({ tick: syncTick, type: 'control_c', vals: [ch, 7, 0] })),
      // Hold the inactive flip group at zero until the next scheduled flip so delayed fade writes cannot reopen it.
      ...inactiveHoldEvents,
      ...activeChannels.map(ch => ({ tick: restoreTick, type: 'control_c', vals: [ch, 7, setBinauralResolveRestoreVolume()] }))
    );
  }
};
