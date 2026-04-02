// convergenceMemory.js - tracks beat positions where convergence events fire,
// builds a histogram, and provides probability boosts at positions that
// historically have high convergence. System learns its own rhythm.

convergenceMemory = (() => {
  const BINS = 16;
  const histogram = new Array(BINS).fill(0);
  let totalSamples = 0;

  function record(absoluteSeconds, layer) {
    const conv = convergenceDetector.wasRecent(absoluteSeconds, layer, 200);
    if (conv) {
      histogram[beatIndex % BINS] += 1;
      totalSamples++;
    }
  }

  function getBoost() {
    if (totalSamples < 20) return 1.0;
    const bin = beatIndex % BINS;
    const avgCount = totalSamples / BINS;
    const binScore = histogram[bin] / m.max(1, avgCount);
    return binScore > 1.5 ? clamp(1.0 + (binScore - 1.5) * 0.3, 1.0, 1.6) : 1.0;
  }

  function reset() {
    for (let i = 0; i < BINS; i++) histogram[i] = 0;
    totalSamples = 0;
  }

  return { record, getBoost, reset };
})();
crossLayerRegistry.register('convergenceMemory', convergenceMemory, ['all', 'section']);
