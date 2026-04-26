// src/conductor/silenceDistributionTracker.js - Rest distribution across layers.
// Analyzes the spatial distribution and coordination of rests (silence gaps)
// across the polyrhythmic layers. Signals clustered silence (tutti pause)
// vs. staggered breathing for the conductor to modulate.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'silenceDistributionTracker',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'validator'],
  provides: ['silenceDistributionTracker'],
  init: (deps) => {
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('silenceDistributionTracker');
  const query = analysisHelpers.createTrackerQuery(V, 6, { minNotes: 4 });

  /**
   * Analyze rest distribution by checking onset gaps per layer.
   * @returns {{ clusterScore: number, staggerScore: number, silenceRatio: number, suggestion: string }}
   */
  function getSilenceSignal() {
    const entries = query();
    if (!entries) return { clusterScore: 0, staggerScore: 0, silenceRatio: 0.5, suggestion: 'maintain' };

    // Group onsets by layer
    /** @type {Object.<string, number[]>} */
    const layerOnsets = {};
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
      V.requireFinite(e.time, 'e.time');
      const layer = String(e.layer || 'default');
      if (!layerOnsets[layer]) layerOnsets[layer] = [];
      layerOnsets[layer].push(e.time);
    }

    const layerKeys = Object.keys(layerOnsets);
    if (layerKeys.length < 2) {
      return { clusterScore: 0, staggerScore: 0, silenceRatio: 0.3, suggestion: 'maintain' };
    }

    // Compute gap statistics per layer
    /** @type {number[]} */
    const maxGaps = [];
    let totalGaps = 0;
    let gapCount = 0;

    for (let k = 0; k < layerKeys.length; k++) {
      const onsets = layerOnsets[layerKeys[k]];
      onsets.sort((a, b) => a - b);
      let maxGap = 0;
      for (let i = 1; i < onsets.length; i++) {
        const gap = onsets[i] - onsets[i - 1];
        totalGaps += gap;
        gapCount++;
        if (gap > maxGap) maxGap = gap;
      }
      maxGaps.push(maxGap);
    }

    // Cluster score: how synchronized are the silences across layers?
    // If all layers have max gaps at similar times - clustered (tutti pause)
    let gapVariance = 0;
    let gapMean = 0;
    for (let i = 0; i < maxGaps.length; i++) gapMean += maxGaps[i];
    gapMean /= maxGaps.length;
    for (let i = 0; i < maxGaps.length; i++) {
      gapVariance += (maxGaps[i] - gapMean) * (maxGaps[i] - gapMean);
    }
    gapVariance /= maxGaps.length;

    // Low variance in max gaps - clustered silence
    const clusterScore = clamp(1 - m.sqrt(gapVariance) * 0.5, 0, 1);
    // High variance - staggered breathing
    const staggerScore = clamp(m.sqrt(gapVariance) * 0.5, 0, 1);

    // Overall silence ratio
    const avgGap = gapCount > 0 ? totalGaps / gapCount : 0;
    const silenceRatio = clamp(avgGap / 2, 0, 1); // normalized

    let suggestion = 'maintain';
    if (clusterScore > 0.7 && silenceRatio > 0.4) suggestion = 'stagger';
    else if (staggerScore > 0.7 && silenceRatio < 0.2) suggestion = 'allow-silence';
    else if (silenceRatio > 0.6) suggestion = 'fill';
    else if (silenceRatio < 0.15) suggestion = 'breathe';

    return { clusterScore, staggerScore, silenceRatio, suggestion };
  }

  conductorIntelligence.registerStateProvider('silenceDistributionTracker', () => {
    const s = silenceDistributionTracker.getSilenceSignal();
    return {
      silenceSuggestion: s ? s.suggestion : 'maintain',
      silenceRatio: s ? s.silenceRatio : 0.3
    };
  });

  function reset() {}
  conductorIntelligence.registerModule('silenceDistributionTracker', { reset }, ['section']);

  return {
    getSilenceSignal
  };
  },
});
