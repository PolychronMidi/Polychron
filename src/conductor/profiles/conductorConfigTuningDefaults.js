conductorConfigTuningDefaults = () => ({
  emissionGate: {
    playBase: 0.72,
    playScale: 0.9,
    stutterBase: 0.6,
    stutterScale: 1.15,
    journeyBoost: 0.08,
    feedbackBoost: 0.08,
    layerBiasScale: 1.0
  },
  feedbackMix: {
    fx: 0.45,
    stutter: 0.2,
    journey: 0.35
  },
  intensityBlend: {
    arc: 0.6,
    tension: 0.4
  },
  stutterGrain: {
    fadeCount: [10, 70],
    fadeDuration: [0.2, 1.5],
    panCount: [30, 90],
    panDuration: [0.1, 1.2],
    fxCount: [30, 100],
    fxDuration: [0.1, 2.0]
  },
  phraseBreath: {
    registerRange: 12,
    densityRange: { min: 0.85, max: 1.3 },
    independence: {
      archInner: 0.7,
      archOuter: 0.3,
      riseFallInner: 0.6,
      riseFallOuter: 0.4,
      buildResolveInner: 0.8,
      buildResolveOuter: 0.3,
      waveBase: 0.4,
      waveAmplitude: 0.4
    },
    dynamism: {
      archBase: 0.5,
      archAmplitude: 0.5,
      riseFallBase: 0.4,
      riseFallAmplitude: 0.6,
      buildResolveBase: 0.3,
      buildResolveSlope: 0.7,
      buildResolveEnd: 0.2,
      waveBase: 0.5,
      waveAmplitude: 0.5
    }
  },
  motifTexture: {
    burstDensity: [0.7, 1.0],
    sparseDensity: [0.3, 0.7],
    burstIntervalDensity: [0.7, 0.95],
    sparseIntervalDensity: [0.4, 0.7]
  },
  motifMutation: {
    transposeRange: [-7, 7]
  },
  spatialCanvas: {
    balOffset: [0, 45],
    balStep: 4,
    sideBias: [-20, 20],
    sideBiasStep: 2,
    lBalMax: 54,
    ccGroupScale: {
      source: 1.0,
      reflection: 1.0,
      bass: 1.0
    },
    ccRangeScale: {
      source: { default: 1.0 },
      reflection: { default: 1.0 },
      bass: { default: 1.0 }
    }
  },
  noiseCanvas: {
    panRange: 60,
    sustainRange: [0.8, 1.2]
  },
  rhythmDrift: {
    burst: [0.5, 1.5],
    flurry: [0.3, 1.0]
  }
});
