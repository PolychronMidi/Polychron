// src/crossLayer/entropyRegulator.js — Cross-layer entropy regulation.
// Measures combined entropy (pitch diversity × rhythmic irregularity × velocity variance)
// of both layers. Defines a target entropy curve (low → high → low for tension arcs).
// Nudges all cross-layer systems up or down to steer total entropy toward the target.
// Acts as a meta-conductor for the cross-layer systems themselves.

EntropyRegulator = (() => {
  const V = Validator.create('EntropyRegulator');
  const WINDOW_NOTES = 20;
  const SMOOTHING = 0.3; // exponential smoothing factor

  let smoothedEntropy = 0.5;
  let targetEntropy = 0.5;
  let regulationStrength = 0.5; // how aggressively to steer (0-1)

  // Beat-level cache: prevent multiple measureEntropy() calls within the same beat
  // from re-smoothing (which corrupts the effective smoothing factor).
  let _lastMeasureBeat = -1;
  let _lastMeasuredEntropy = 0.5;

  /** @type {Map<string, number[]>} recent MIDI notes per layer */
  const noteHistory = new Map();
  /** @type {Map<string, number[]>} recent velocities per layer */
  const velHistory = new Map();

  /**
   * Record a note + velocity for entropy measurement.
   * @param {number} midi
   * @param {number} velocity
   * @param {string} layer
   */
  function recordSample(midi, velocity, layer) {
    if (!noteHistory.has(layer)) noteHistory.set(layer, []);
    if (!velHistory.has(layer)) velHistory.set(layer, []);
    const nh = noteHistory.get(layer);
    const vh = velHistory.get(layer);
    if (!nh) throw new Error('EntropyRegulator.recordSample: missing note history for layer ' + layer);
    if (!vh) throw new Error('EntropyRegulator.recordSample: missing velocity history for layer ' + layer);
    nh.push(midi);
    vh.push(velocity);
    if (nh.length > WINDOW_NOTES) nh.shift();
    if (vh.length > WINDOW_NOTES) vh.shift();
  }

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
      H -= p * Math.log2(p);
    }
    return clamp(H / Math.log2(12), 0, 1); // normalize by max possible entropy
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
    // Max variance is ~(127/2)^2 ≈ 4032
    return clamp(Math.sqrt(variance) / 45, 0, 1);
  }

  /**
   * Compute rhythmic irregularity from note timing.
   * Higher when inter-onset intervals are unpredictable.
   * @param {string} layer
   * @returns {number} 0-1
   */
  function rhythmicIrregularity(layer) {
    // Use AbsoluteTimeWindow note history if available
    if (!AbsoluteTimeWindow) return 0.5;
    V.requireFinite(beatStartTime, 'beatStartTime');
    const notes = AbsoluteTimeWindow.getNotes({
      layer,
      since: beatStartTime - 2,
      windowSeconds: 2
    });
    if (notes.length < 3) return 0;
    const iois = [];
    for (let i = 1; i < notes.length; i++) {
      const currentTime = Number(notes[i].time);
      const previousTime = Number(notes[i - 1].time);
      if (!Number.isFinite(currentTime) || !Number.isFinite(previousTime)) {
        throw new Error('EntropyRegulator: note time entries must be finite');
      }
      const dt = currentTime - previousTime;
      if (dt > 0) iois.push(dt);
    }
    if (iois.length < 2) return 0;
    const mean = iois.reduce((a, b) => a + b, 0) / iois.length;
    const cv = Math.sqrt(iois.reduce((s, v) => s + (v - mean) * (v - mean), 0) / iois.length) / Math.max(mean, 0.001);
    return clamp(cv, 0, 1);
  }

  /**
   * Measure combined entropy of both layers.
   * @returns {number} combined 0-1
   */
  function measureEntropy() {
    // Guard: only re-compute and re-smooth once per beat to prevent
    // multiple callers (getRegulation, regulate, CrossLayerSilhouette.tick)
    // from compounding the exponential smoothing factor.
    const currentBeat = typeof beatCount === 'number' ? beatCount : -1;
    if (currentBeat === _lastMeasureBeat && currentBeat >= 0) return _lastMeasuredEntropy;
    _lastMeasureBeat = currentBeat;

    const layers = ['L1', 'L2'];
    let totalPitch = 0, totalVel = 0, totalRhythm = 0, count = 0;
    for (const layer of layers) {
      const nh = noteHistory.get(layer);
      const vh = velHistory.get(layer);
      if (nh && nh.length > 2) {
        totalPitch += pitchEntropy(nh);
        count++;
      }
      if (vh && vh.length > 2) {
        totalVel += velocityVariance(vh);
      }
      totalRhythm += rhythmicIrregularity(layer);
    }
    if (count === 0) { _lastMeasuredEntropy = 0.5; return 0.5; }
    const combined = (totalPitch / count) * 0.4 + (totalVel / Math.max(count, 1)) * 0.3 + (totalRhythm / 2) * 0.3;
    smoothedEntropy = smoothedEntropy * (1 - SMOOTHING) + combined * SMOOTHING;
    _lastMeasuredEntropy = smoothedEntropy;
    return smoothedEntropy;
  }

  /**
   * Set the target entropy for the current musical moment.
   * Can be driven by section position, ConductorState, or manually.
   * @param {number} target - 0-1
   */
  function setTarget(target) {
    targetEntropy = clamp(target, 0, 1);
  }

  /**
   * Compute target entropy from section position (arc curve).
   * Low at section boundaries, high in the middle.
   * @param {number} sectionProgress - 0-1 progress through current section
   */
  function setTargetFromArc(sectionProgress) {
    // Bell curve: peaks at 0.5, troughs at 0 and 1
    const arc = Math.sin(clamp(sectionProgress, 0, 1) * Math.PI);
    targetEntropy = 0.2 + arc * 0.6; // range 0.2 - 0.8
  }

  /**
   * Get regulation modifier: how much to scale cross-layer system activity.
   * > 1 means increase activity, < 1 means decrease.
   * @returns {{ scale: number, currentEntropy: number, targetEntropy: number, error: number }}
   */
  function getRegulation() {
    const current = measureEntropy();
    const error = targetEntropy - current;
    // PID-like: proportional response
    const scale = clamp(1 + error * regulationStrength * 2, 0.3, 2.0);
    return { scale, currentEntropy: current, targetEntropy, error };
  }

  /**
   * Apply regulation to a probability value.
   * @param {number} prob - original probability 0-1
   * @returns {number} regulated probability 0-1
   */
  function regulate(prob) {
    const { scale } = getRegulation();
    return clamp(prob * scale, 0, 1);
  }

  /** @param {number} strength - 0-1 */
  function setRegulationStrength(strength) {
    regulationStrength = clamp(strength, 0, 1);
  }

  function reset() {
    smoothedEntropy = 0.5;
    targetEntropy = 0.5;
    regulationStrength = 0.5;
    _lastMeasureBeat = -1;
    _lastMeasuredEntropy = 0.5;
    noteHistory.clear();
    velHistory.clear();
  }

  return {
    recordSample, measureEntropy, setTarget, setTargetFromArc,
    getRegulation, regulate, setRegulationStrength, reset
  };
})();
CrossLayerRegistry.register('EntropyRegulator', EntropyRegulator, ['all', 'section']);
