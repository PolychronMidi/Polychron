// grandFinaleBinaural.js - Post-loop binaural shift emitter.
// Runs once after all beat loops complete, before grandFinale writes CSVs.
// Computes a shift schedule over the full track time range and pushes
// CC/pitch-bend events directly into both L1 and L2 buffers.
// This guarantees both layers get identical shifts at identical wall-clock
// seconds with no per-beat consumption race.

const V_gfb = validator.create('grandFinaleBinaural');

grandFinaleBinaural = () => {
  V_gfb.requireDefined(BINAURAL, 'BINAURAL');
  V_gfb.requireDefined(binauralOffset, 'binauralOffset');
  V_gfb.requireDefined(LM.layers, 'LM.layers');

  const l1Buffer = LM.layers['L1'] && LM.layers['L1'].buffer;
  const l2Buffer = LM.layers['L2'] && LM.layers['L2'].buffer;
  if (!Array.isArray(l1Buffer) || !Array.isArray(l2Buffer)) return;

  // Determine track time range from L0 (no pruning, full history available)
  const noteBounds = L0.getBounds('note');
  if (!noteBounds || !noteBounds.first || !noteBounds.last) return;
  const trackStart = m.max(0, noteBounds.first.timeInSeconds);
  const trackEnd   = noteBounds.last.timeInSeconds;
  if (trackEnd <= trackStart) return;

  // Walk the track and schedule shifts at a random interval (2-4 s).
  // Regime-responsiveness is skipped here - we're post-loop and have no
  // live snapshot. A fixed random interval is sufficient.
  let currentFreqOffset = clamp(binauralFreqOffset, BINAURAL.min, BINAURAL.max);
  let currentFlip = flipBin;
  let t = trackStart;

  while (t <= trackEnd) {
    currentFlip = !currentFlip;
    currentFreqOffset = rl(currentFreqOffset, -.5, .5, BINAURAL.min, BINAURAL.max, 'f');
    binauralFreqOffset = currentFreqOffset;
    const [plus, minus] = [1, -1].map(binauralOffset);

    const shiftActiveChannels   = currentFlip ? flipBinT2 : flipBinF2;
    const shiftInactiveChannels = currentFlip ? flipBinF2 : flipBinT2;

    const events = [
      ...shiftActiveChannels.map(ch   => ({ timeInSeconds: t, type: 'control_c',    vals: [ch, 64,  0] })),
      ...shiftActiveChannels.map(ch   => ({ timeInSeconds: t, type: 'control_c',    vals: [ch, 123, 0] })),
      ...shiftActiveChannels.map(ch   => ({ timeInSeconds: t, type: 'control_c',    vals: [ch, 120, 0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: t, type: 'control_c',    vals: [ch, 64,  0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: t, type: 'control_c',    vals: [ch, 123, 0] })),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: t, type: 'control_c',    vals: [ch, 120, 0] })),
      ...binauralL.map(ch => ({ timeInSeconds: t, type: 'pitch_bend_c', vals: [ch,
        (ch === lCH1 || ch === lCH3 || ch === lCH5)
          ? (currentFlip ? minus : plus)
          : (currentFlip ? plus  : minus)
      ]})),
      ...binauralR.map(ch => ({ timeInSeconds: t, type: 'pitch_bend_c', vals: [ch,
        (ch === rCH1 || ch === rCH3 || ch === rCH5)
          ? (currentFlip ? plus  : minus)
          : (currentFlip ? minus : plus)
      ]})),
      ...shiftInactiveChannels.map(ch => ({ timeInSeconds: t, type: 'control_c', vals: [ch, 7, 0]        })),
      ...shiftActiveChannels.map(ch   => ({ timeInSeconds: t, type: 'control_c', vals: [ch, 7, velocity] })),
    ];

    l1Buffer.push(...events);
    l2Buffer.push(...events);

    if (traceDrain && traceDrain.isEnabled()) {
      traceDrain.recordBinauralShift({
        layer: 'shared',
        absTimeMs: t * 1000,
        syncMs: t * 1000,
        usedCrossLayerShift: false,
        syncDeltaMs: 0,
        freqOffset: currentFreqOffset,
        toleranceMs: 0,
        flip: currentFlip
      });
    }

    t += rf(2.0, 4.0);
  }

  // Update globals so post-run state reflects the final shift
  binauralFreqOffset = currentFreqOffset;
  flipBin = currentFlip;
};
