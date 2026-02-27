// signalTelemetry.js - Per-beat signal history for post-hoc analysis.
// Records a lightweight snapshot of key signal products each beat.
// Detects anomalies (>30% change from rolling mean) for debugging emergent moments.

signalTelemetry = (() => {
  const V = validator.create('signalTelemetry');
  const MAX_HISTORY = 200;
  /** @type {Array<{ tick: number, density: number, tension: number, flicker: number, compositeIntensity: number }>} */
  const history = [];

  // Rolling stats for anomaly detection
  let rollingDensitySum = 0;
  let rollingTensionSum = 0;
  let anomalyDetected = false;
  let trend = 'stable'; // 'stable' | 'rising' | 'falling'

  /**
   * Record current signal state. Called each beat via registerRecorder.
   * @param {{ absTime: number, compositeIntensity: number, currentDensity: number, harmonicRhythm: number }} ctx
   */
  function record(ctx) {
    const d = signalReader.density();
    const t = signalReader.tension();
    const f = signalReader.flicker();

    const entry = {
      tick: ctx.absTime,
      density: d,
      tension: t,
      flicker: f,
      compositeIntensity: ctx.compositeIntensity
    };

    history.push(entry);
    rollingDensitySum += d;
    rollingTensionSum += t;

    // Evict oldest if over capacity
    if (history.length > MAX_HISTORY) {
      const evicted = /** @type {{ density: number, tension: number }} */ (history.shift());
      rollingDensitySum -= evicted.density;
      rollingTensionSum -= evicted.tension;
    }

    _detectAnomaly();
    _updateTrend();
  }

  /** Check if latest beat deviates >30% from rolling mean. */
  function _detectAnomaly() {
    anomalyDetected = false;
    if (history.length < 8) return;

    const latest = history[history.length - 1];
    const meanD = rollingDensitySum / history.length;
    const meanT = rollingTensionSum / history.length;

    const dDev = meanD > 0 ? m.abs(latest.density - meanD) / meanD : 0;
    const tDev = meanT > 0 ? m.abs(latest.tension - meanT) / meanT : 0;

    anomalyDetected = dDev > 0.3 || tDev > 0.3;
  }

  /** Compute trend from recent compositeIntensity slope. */
  function _updateTrend() {
    if (history.length < 6) {
      trend = 'stable';
    } else {
      const recent = history.slice(-6);
      const first3 = (recent[0].compositeIntensity + recent[1].compositeIntensity + recent[2].compositeIntensity) / 3;
      const last3 = (recent[3].compositeIntensity + recent[4].compositeIntensity + recent[5].compositeIntensity) / 3;
      const slope = last3 - first3;

      if (slope > 0.06) trend = 'rising';
      else if (slope < -0.06) trend = 'falling';
      else trend = 'stable';
    }
  }

  /**
   * Get the last N snapshots.
   * @param {number} [n=20]
   * @returns {Array<{ tick: number, density: number, tension: number, flicker: number, compositeIntensity: number }>}
   */
  function getHistory(n) {
    const maybeCount = V.optionalFinite(n);
    const count = maybeCount === undefined
      ? m.min(20, history.length)
      : m.max(1, m.min(maybeCount, history.length));
    return history.slice(-count);
  }

  /** @returns {boolean} */
  function isAnomalyDetected() {
    return anomalyDetected;
  }

  /** @returns {string} */
  function getTrend() {
    return trend;
  }

  /** Reset all tracking. */
  function reset() {
    history.length = 0;
    rollingDensitySum = 0;
    rollingTensionSum = 0;
    anomalyDetected = false;
    trend = 'stable';
  }

  // Self-register
  conductorIntelligence.registerRecorder('signalTelemetry', record);
  conductorIntelligence.registerStateProvider('signalTelemetry', () => ({
    telemetryAnomalyDetected: anomalyDetected,
    telemetryTrend: trend
  }));
  conductorIntelligence.registerModule('signalTelemetry', { reset }, ['section']);

  return { record, getHistory, isAnomalyDetected, getTrend, reset };
})();
