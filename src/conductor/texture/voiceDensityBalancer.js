// src/conductor/voiceDensityBalancer.js - Counts simultaneous active voices per layer.
// Detects homophonic collapse (1 voice) or textural overcrowding.
// Pure query API - scales motifConfig voice count targets and emission limits.

voiceDensityBalancer = (() => {
  const V = validator.create('voiceDensityBalancer');
  const WINDOW_SECONDS = 2;
  const COINCIDENCE_MS = 0.05; // notes within 50ms count as simultaneous

  /**
   * Estimate simultaneous voice count in the recent window.
   * Groups notes by time proximity to approximate polyphony depth.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ avgVoices: number, maxVoices: number, thin: boolean, crowded: boolean }}
   */
  function getVoiceDensity(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = absoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 2) {
      return { avgVoices: notes.length, maxVoices: notes.length, thin: true, crowded: false };
    }

    // Group notes into simultaneous clusters
    const clusters = [];
    let clusterStart = notes[0].time;
    let clusterCount = 1;

    for (let i = 1; i < notes.length; i++) {
      if (notes[i].time - clusterStart <= COINCIDENCE_MS) {
        clusterCount++;
      } else {
        clusters.push(clusterCount);
        clusterStart = notes[i].time;
        clusterCount = 1;
      }
    }
    clusters.push(clusterCount);

    let sum = 0;
    let maxV = 0;
    for (let i = 0; i < clusters.length; i++) {
      sum += clusters[i];
      if (clusters[i] > maxV) maxV = clusters[i];
    }

    const avgVoices = sum / clusters.length;
    return {
      avgVoices,
      maxVoices: maxV,
      thin: avgVoices < 1.5,
      crowded: avgVoices > 4
    };
  }

  /**
   * Get a voice-count bias for motifConfig.
   * Thin - encourage more voices; crowded - reduce.
   * Continuous interpolation prevents multiplicative crush with peer density biases.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
  * @returns {number} - 0.88 to 1.3
   */
  function getVoiceCountBias(opts) {
    const vd = getVoiceDensity(opts);
    // Continuous ramp based on avgVoices: thin (<1.5) - boost, crowded (>4) - dampen
    if (vd.avgVoices < 1.5) {
      const ramp = clamp((1.5 - vd.avgVoices) / 1.5, 0, 1);
      return 1.0 + ramp * 0.3;
    }
    if (vd.avgVoices > 4) {
      // Wider ramp: saturates at 10 voices instead of 8, softer max suppression
      const ramp = clamp((vd.avgVoices - 4) / 6, 0, 1);
      return 1.0 - ramp * 0.12;
    }
    return 1.0;
  }

  /**
   * Compare voice density across layers.
   * @returns {{ l1Avg: number, l2Avg: number, balanced: boolean }}
   */
  function getCrossLayerBalance() {
    const l1 = getVoiceDensity({ layer: 'L1' });
    const l2 = getVoiceDensity({ layer: 'L2' });
    const balanced = m.abs(l1.avgVoices - l2.avgVoices) < 1.5;
    return { l1Avg: l1.avgVoices, l2Avg: l2.avgVoices, balanced };
  }

  conductorIntelligence.registerDensityBias('voiceDensityBalancer', () => voiceDensityBalancer.getVoiceCountBias(), 0.90, 1.3);

  return {
    getVoiceDensity,
    getVoiceCountBias,
    getCrossLayerBalance
  };
})();
