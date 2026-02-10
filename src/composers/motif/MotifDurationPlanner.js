// MotifDurationPlanner.js - duration planning helper

/**
 * Computes target durations that sum to a total tick budget.
 * Used for fitting motifs to a phrase or explicit total ticks.
 */
MotifDurationPlanner = {
  /**
   * Build duration array that sums to totalTicks
   * @param {number} length - Number of motif steps
   * @param {number} totalTicks - Total tick budget to distribute
   * @returns {number[]|null} Array of durations or null when invalid
   */
  buildTargetDurations(length, totalTicks) {
    if (!Number.isFinite(Number(length)) || Number(length) <= 0) return null;
    if (!Number.isFinite(Number(totalTicks)) || Number(totalTicks) <= 0) return null;

    const len = Number(length);
    const total = Number(totalTicks);

    // Evenly distribute ticks across motif length; shuffle remainder for variety
    const base = Math.floor(total / len);
    const remainder = total - base * len;
    const targetDurations = Array.from({ length: len }, (_, i) => base + (i < remainder ? 1 : 0));

    // Randomize distribution slightly while preserving sum: swap some units
    for (let k = 0; k < Math.min(3, len); k++) {
      const i = Math.floor(Math.random() * len);
      const j = Math.floor(Math.random() * len);
      if (i !== j && targetDurations[i] > 1) {
        const delta = Math.round((Math.random() - 0.5) * Math.min(2, Math.floor(targetDurations[i] * 0.1)));
        targetDurations[i] = Math.max(1, targetDurations[i] - delta);
        targetDurations[j] = Math.max(1, targetDurations[j] + delta);
      }
    }

    // Ensure sum unchanged (small numeric safety pass)
    let sum = targetDurations.reduce((a, b) => a + b, 0);
    let idx = 0;
    while (sum !== total) {
      if (sum < total) {
        targetDurations[idx % len]++;
        sum++;
      } else if (targetDurations[idx % len] > 1) {
        targetDurations[idx % len]--;
        sum--;
      }
      idx++;
      if (idx > len * 3) break;
    }

    return targetDurations;
  }
};
