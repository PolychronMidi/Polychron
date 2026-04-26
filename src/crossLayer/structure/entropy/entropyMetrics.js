// src/crossLayer/structure/entropyMetrics.js
// Pure entropy measurement helpers for entropyRegulator.
// Extracted to keep entropyRegulator.js focused on regulation logic.

moduleLifecycle.declare({
  name: 'entropyMetrics',
  subsystem: 'crossLayer',
  deps: ['validator'],
  provides: ['entropyMetrics'],
  init: (deps) => {
  const V = deps.validator.create('entropyMetrics');

  /**
   * Compute pitch-class diversity (Shannon entropy normalized to 0-1).
   * @param {number[]} notes
   * @returns {number} 0-1
   */
  function pitchEntropy(notes) {
    if (notes.length < 2) return 0;
    const counts = new Array(12).fill(0);
    for (let i = 0; i < notes.length; i++) counts[((notes[i] % 12) + 12) % 12]++;
    let H = 0;
    const n = notes.length;
    for (let i = 0; i < 12; i++) {
      if (counts[i] === 0) continue;
      const p = counts[i] / n;
      H -= p * m.log2(p);
    }
    return clamp(H / m.log2(12), 0, 1);
  }

  /**
   * Compute velocity variance normalized to 0-1.
   * @param {number[]} velocities
   * @returns {number} 0-1
   */
  function velocityVariance(velocities) {
    if (velocities.length < 2) return 0;
    const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    const variance = velocities.reduce((s, v) => s + (v - mean) * (v - mean), 0) / velocities.length;
    // Max std-dev is ~45 (half of 127/sqrt(3)), normalised accordingly
    return clamp(m.sqrt(variance) / 45, 0, 1);
  }

  /**
   * Compute rhythmic irregularity from note timing.
   * Higher when inter-onset intervals are unpredictable.
   * @param {string} layer
   * @returns {number} 0-1
   */
  function rhythmicIrregularity(layer) {
    V.requireDefined(L0, 'L0');
    V.requireFinite(beatStartTime, 'beatStartTime');
    const notes = L0.query(L0_CHANNELS.note, {
      layer,
      since: beatStartTime - 2,
      windowSeconds: 2
    });
    if (notes.length < 3) return 0;
    const iois = [];
    for (let i = 1; i < notes.length; i++) {
      const currentTime = Number(notes[i].timeInSeconds);
      const previousTime = Number(notes[i - 1].timeInSeconds);
      V.requireFinite(currentTime, 'currentTime');
      V.requireFinite(previousTime, 'previousTime');
      const dt = currentTime - previousTime;
      if (dt > 0) iois.push(dt);
    }
    if (iois.length < 2) return 0;
    const mean = iois.reduce((a, b) => a + b, 0) / iois.length;
    const cv = m.sqrt(iois.reduce((s, v) => s + (v - mean) * (v - mean), 0) / iois.length) / m.max(mean, 0.001);
    return clamp(cv, 0, 1);
  }

  return { pitchEntropy, velocityVariance, rhythmicIrregularity };
  },
});
