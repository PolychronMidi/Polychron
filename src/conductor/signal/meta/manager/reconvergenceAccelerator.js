// reconvergenceAccelerator.js - detects structural discontinuities in
// EMA inputs and temporarily raises alpha for fast reconvergence.
// When a major architectural change (tick rate, gating) shifts EMA inputs,
// the old calibration is wrong. This module detects the shift and
// accelerates convergence for 50-100 ticks, then decays back to normal.

moduleLifecycle.declare({
  name: 'reconvergenceAccelerator',
  subsystem: 'conductor',
  deps: [],
  provides: ['reconvergenceAccelerator'],
  init: (deps) => {
  const DETECTION_WINDOW = 8;
  const JUMP_THRESHOLD = 0.25;
  const ACCEL_ALPHA = 0.4;
  const NORMAL_DECAY = 0.92;
  const MIN_ACCEL_TICKS = 50;

  let inputHistory = [];
  let accelerating = false;
  let accelTicksRemaining = 0;
  let currentMultiplier = 1.0;

  function recordInput(value) {
    inputHistory.push(value);
    if (inputHistory.length > DETECTION_WINDOW * 2) inputHistory.shift();

    if (inputHistory.length >= DETECTION_WINDOW * 2) {
      const firstHalf = inputHistory.slice(0, DETECTION_WINDOW);
      const secondHalf = inputHistory.slice(DETECTION_WINDOW);
      const avg1 = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
      const avg2 = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
      const jump = m.abs(avg2 - avg1);
      if (jump > JUMP_THRESHOLD && !accelerating) {
        accelerating = true;
        accelTicksRemaining = MIN_ACCEL_TICKS;
        currentMultiplier = ACCEL_ALPHA / 0.08;
      }
    }

    if (accelerating) {
      accelTicksRemaining--;
      currentMultiplier *= NORMAL_DECAY;
      if (accelTicksRemaining <= 0 || currentMultiplier < 1.1) {
        accelerating = false;
        currentMultiplier = 1.0;
      }
    }
  }

  function getAlphaMultiplier() { return currentMultiplier; }
  function isAccelerating() { return accelerating; }

  function reset() {
    inputHistory = [];
    accelerating = false;
    accelTicksRemaining = 0;
    currentMultiplier = 1.0;
  }

  return { recordInput, getAlphaMultiplier, isAccelerating, reset };
  },
});
