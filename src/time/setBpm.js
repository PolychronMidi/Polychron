// setBpm.js - Emit BPM MIDI event and recompute spMeasure.
// Single responsibility: BPM changes. Always emits set_bpm to active buffer.
// Split from midiTiming.js for SRP (R43).
// Freezes timing snapshot after computation (R44 -- fail fast on mutation).

/** @type {{ effectiveBpm: number, spMeasure: number, bpmScale: number } | null} */
let lastBpmSnapshot = null;

setBpm = () => {
  if (!Number.isFinite(BPM) || BPM <= 0) {
    throw new Error('setBpm: BPM must be a positive finite number, got ' + BPM);
  }
  const effectiveBpm = BPM * (Number.isFinite(sectionBpmScale) ? sectionBpmScale : 1.0);
  spMeasure = (60 / effectiveBpm) * 4 * meterRatio;
  if (!Number.isFinite(spMeasure) || spMeasure <= 0) {
    throw new Error('setBpm: invalid spMeasure ' + spMeasure + ' from BPM=' + BPM + ' meterRatio=' + meterRatio);
  }
  p(c, { timeInSeconds: measureStartTime, type: 'bpm', vals: [effectiveBpm] });
  L0.post(L0_CHANNELS.tickDuration, LM.activeLayer || 'shared', measureStartTime, {
    oneTickInSeconds: 60 / (effectiveBpm * PPQ), effectiveBpm, bpmScale: sectionBpmScale
  });
  lastBpmSnapshot = deepFreeze({ effectiveBpm, spMeasure, bpmScale: Number.isFinite(sectionBpmScale) ? sectionBpmScale : 1.0 });
};

/** @returns {{ effectiveBpm: number, spMeasure: number, bpmScale: number } | null} */
setBpm.getSnapshot = () => lastBpmSnapshot;
