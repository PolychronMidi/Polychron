/**
 * Manages binaural beat pitch shifts and volume crossfades at beat boundaries,
 * synced across layers via absoluteTimeGrid using ms-precision timestamps.
 * This should not be a perceptible effect, allNoteOff is used to prevent detune artifacts.
 * @returns {void}
 */
const V = validator.create('setBinaural');

/** Millisecond tolerance for treating two layer shifts as the same event */
const BINAURAL_SYNC_TOLERANCE_MS = 24;
const BINAURAL_END_GUARD_MS = 2600;
const BINAURAL_MEAN_REVERSION = 0.28;
const BINAURAL_STEP_MIN = 0.2;
const BINAURAL_STEP_MAX = 0.55;
const BINAURAL_INACTIVE_HOLD_STEP_DIVISOR = 16;
const BINAURAL_SOURCE_RESTORE_VOL = 104;
const BINAURAL_REFLECTION_RESTORE_VOL = 100;
const BINAURAL_BASS_RESTORE_VOL = 102;

/** Next absolute ms at which a timed binaural shift should fire */
let nextBinauralShiftMs = 0;

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
  const holdStep = m.max(1, m.round(tpBeat / BINAURAL_INACTIVE_HOLD_STEP_DIVISOR));
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

function setBinauralResolveRestoreVolume(channel) {
  if (source.includes(channel)) return BINAURAL_SOURCE_RESTORE_VOL;
  if (reflection.includes(channel)) return BINAURAL_REFLECTION_RESTORE_VOL;
  if (bass.includes(channel)) return BINAURAL_BASS_RESTORE_VOL;
  return BINAURAL_SOURCE_RESTORE_VOL;
}

setBinaural = () => {
  V.requireFinite(beatIndex, 'beatIndex');
  V.requireFinite(measureIndex, 'measureIndex');
  V.requireDefined(conductorState, 'conductorState');
  V.requireDefined(BINAURAL, 'BINAURAL');
  V.requireDefined(binauralOffset, 'binauralOffset');
  V.requireDefined(absoluteTimeGrid, 'absoluteTimeGrid');
  V.requireFinite(beatStartTime, 'beatStartTime');

  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const absTimeMs = beatStartTime * 1000;

  const phraseBoundary = beatIndex === 0 && measureIndex === 0;
  const statePhraseBoundary = (() => {
    const state = conductorState.getSnapshot();
    V.requireDefined(state, 'conductorState.getSnapshot()');
    V.requireFinite(state.phrasePosition, 'state.phrasePosition');
    return state.phrasePosition <= 0.001 && beatIndex === 0;
  })();
  const timedShift = absTimeMs >= nextBinauralShiftMs;
  const finalTimeMs = V.optionalFinite(Number(finalTime), 0) * 1000;
  const nearTrackEnd = finalTimeMs > 0 && absTimeMs >= m.max(0, finalTimeMs - BINAURAL_END_GUARD_MS);
  const shouldShift = firstLoop < 1 || phraseBoundary || statePhraseBoundary || (timedShift && !nearTrackEnd);

  if (shouldShift) {
    beatCount = 0;
    nextBinauralShiftMs = absTimeMs + rf(2.5, 5.5) * 1000;

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
      const currentOffset = V.optionalFinite(Number(binauralFreqOffset), (BINAURAL.min + BINAURAL.max) * 0.5);
      const targetOffset = (BINAURAL.min + BINAURAL.max) * 0.5;
      const recenteredOffset = currentOffset + (targetOffset - currentOffset) * BINAURAL_MEAN_REVERSION;
      binauralFreqOffset = rl(recenteredOffset, -BINAURAL_STEP_MAX, BINAURAL_STEP_MAX, BINAURAL.min + BINAURAL_STEP_MIN, BINAURAL.max - BINAURAL_STEP_MIN);
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
        nearTrackEnd,
        freqOffset: binauralFreqOffset,
        targetOffset: (BINAURAL.min + BINAURAL.max) * 0.5,
        toleranceMs: BINAURAL_SYNC_TOLERANCE_MS,
        flip: flipBin
      });
    }

    p(c,
      ...binauralL.map(ch => ({ tick: syncTick, type: 'pitch_bend_c', vals: [ch, ch === lCH1 || ch === lCH3 || ch === lCH5 ? (flipBin ? binauralMinus : binauralPlus) : (flipBin ? binauralPlus : binauralMinus)] })),
      ...binauralR.map(ch => ({ tick: syncTick, type: 'pitch_bend_c', vals: [ch, ch === rCH1 || ch === rCH3 || ch === rCH5 ? (flipBin ? binauralPlus : binauralMinus) : (flipBin ? binauralMinus : binauralPlus)] }))
    );

    const restoreTick = syncTick + 1;
    const nextShiftTick = m.max(restoreTick, crossLayerHelpers.msToSyncTick(nextBinauralShiftMs));
    const activeChannels = flipBin ? flipBinT2 : flipBinF2;
    const inactiveChannels = flipBin ? flipBinF2 : flipBinT2;
    const muteChannels = Array.from(new Set([...flipBinF2, ...flipBinT2]));
    const inactiveHoldEvents = setBinauralBuildInactiveHoldEvents(restoreTick, nextShiftTick, inactiveChannels);
    p(c,
      ...muteChannels.map(ch => ({ tick: syncTick, type: 'control_c', vals: [ch, 7, 0] })),
      // Hold the inactive flip group at zero until the next scheduled flip so delayed fade writes cannot reopen it.
      ...inactiveHoldEvents,
      ...activeChannels.map(ch => ({ tick: restoreTick, type: 'control_c', vals: [ch, 7, setBinauralResolveRestoreVolume(ch)] }))
    );
  }
};
