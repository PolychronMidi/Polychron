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
    const rand = (typeof rf === 'function') ? rf : (() => { throw new Error('Random generator rf() not available'); });
    const randInt = (typeof ri === 'function') ? ri : (() => { throw new Error('Random integer generator ri() not available'); });

    // Evenly distribute ticks across motif length; shuffle remainder for variety
    const base = m.floor(total / len);
    const remainder = total - base * len;
    const targetDurations = Array.from({ length: len }, (_, i) => base + (i < remainder ? 1 : 0));

    // Randomize distribution slightly while preserving sum: swap some units
    for (let k = 0; k < m.min(3, len); k++) {
      const i = randInt(len - 1);
      const j = randInt(len - 1);
      if (i !== j && targetDurations[i] > 1) {
        const delta = m.round(rand(-0.5, 0.5) * m.min(2, m.floor(targetDurations[i] * 0.1)));
        targetDurations[i] = m.max(1, targetDurations[i] - delta);
        targetDurations[j] = m.max(1, targetDurations[j] + delta);
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
