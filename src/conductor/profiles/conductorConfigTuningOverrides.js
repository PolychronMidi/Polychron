conductorConfigTuningOverrides = () => ({
  restrained: {
    emissionGate: { playBase: 0.52, playScale: 0.65, stutterBase: 0.44, stutterScale: 0.85, journeyBoost: 0.03, feedbackBoost: 0.03 },
    feedbackMix: { fx: 0.35, stutter: 0.15, journey: 0.5 },
    intensityBlend: { arc: 0.45, tension: 0.55 },
    stutterGrain: { fadeCount: [8, 45], panCount: [18, 60], fxCount: [20, 70] },
    phraseBreath: {
      registerRange: 9,
      densityRange: { min: 0.8, max: 1.1 },
      independence: { archInner: 0.6, archOuter: 0.25, buildResolveInner: 0.7, waveAmplitude: 0.25 },
      dynamism: { archBase: 0.35, archAmplitude: 0.35, waveAmplitude: 0.35 }
    },
    motifTexture: { burstDensity: [0.65, 0.9], sparseDensity: [0.35, 0.65] },
    motifMutation: { transposeRange: [-5, 5] },
    spatialCanvas: {
      balOffset: [0, 35],
      balStep: 3,
      sideBias: [-14, 14],
      lBalMax: 46,
      ccGroupScale: { source: 0.85, reflection: 0.9, bass: 0.85 },
      ccRangeScale: {
        source: { default: 0.85, 74: 0.75, 91: 0.7, 92: 0.7, 93: 0.7, 94: 0.65, 95: 0.7 },
        reflection: { default: 0.9, 91: 0.8, 92: 0.8, 93: 0.8, 94: 0.75, 95: 0.8 },
        bass: { default: 0.82, 71: 0.75, 74: 0.8, 91: 0.68, 92: 0.68, 93: 0.68, 94: 0.62, 95: 0.68 }
      }
    },
    noiseCanvas: { panRange: 45, sustainRange: [0.9, 1.1] },
    rhythmDrift: { burst: [0.3, 0.9], flurry: [0.2, 0.6] }
  },
  explosive: {
    emissionGate: { playBase: 0.82, playScale: 1.05, stutterBase: 0.72, stutterScale: 1.35, journeyBoost: 0.1, feedbackBoost: 0.12 },
    feedbackMix: { fx: 0.5, stutter: 0.3, journey: 0.2 },
    intensityBlend: { arc: 0.68, tension: 0.32 },
    stutterGrain: {
      fadeCount: [24, 110],
      fadeDuration: [0.15, 1.1],
      panCount: [45, 130],
      panDuration: [0.08, 0.9],
      fxCount: [50, 145],
      fxDuration: [0.08, 1.5]
    },
    phraseBreath: {
      registerRange: 18,
      densityRange: { min: 0.95, max: 1.5 },
      independence: { archInner: 0.82, archOuter: 0.4, buildResolveInner: 0.92, waveAmplitude: 0.55 },
      dynamism: { archBase: 0.6, archAmplitude: 0.55, buildResolveBase: 0.45, buildResolveSlope: 0.9, waveAmplitude: 0.7 }
    },
    motifTexture: { burstDensity: [0.8, 1.0], sparseDensity: [0.25, 0.65], burstIntervalDensity: [0.8, 1.0], sparseIntervalDensity: [0.35, 0.65] },
    motifMutation: { transposeRange: [-12, 12] },
    spatialCanvas: {
      balOffset: [0, 58],
      balStep: 6,
      sideBias: [-30, 30],
      sideBiasStep: 3,
      lBalMax: 70,
      ccGroupScale: { source: 1.2, reflection: 1.35, bass: 1.15 },
      ccRangeScale: {
        source: { default: 1.2, 11: 1.25, 70: 1.2, 71: 1.2, 74: 1.3, 91: 1.25, 92: 1.25, 93: 1.25, 94: 1.3, 95: 1.2 },
        reflection: { default: 1.35, 11: 1.4, 70: 1.35, 71: 1.35, 74: 1.45, 91: 1.55, 92: 1.55, 93: 1.55, 94: 1.6, 95: 1.45 },
        bass: { default: 1.15, 5: 1.1, 70: 1.2, 71: 1.2, 74: 1.2, 91: 1.1, 92: 1.1, 93: 1.1, 94: 1.15, 95: 1.1 }
      }
    },
    noiseCanvas: { panRange: 80, sustainRange: [0.7, 1.35] },
    rhythmDrift: { burst: [0.9, 2.3], flurry: [0.5, 1.4] }
  },
  atmospheric: {
    emissionGate: { playBase: 0.74, playScale: 0.88, stutterBase: 0.56, stutterScale: 0.95, journeyBoost: 0.1, feedbackBoost: 0.06 },
    feedbackMix: { fx: 0.35, stutter: 0.15, journey: 0.5 },
    intensityBlend: { arc: 0.72, tension: 0.28 },
    stutterGrain: {
      fadeCount: [8, 55],
      fadeDuration: [0.5, 2.2],
      panCount: [16, 64],
      panDuration: [0.3, 1.8],
      fxCount: [18, 72],
      fxDuration: [0.3, 2.4]
    },
    phraseBreath: {
      registerRange: 10,
      densityRange: { min: 0.7, max: 1.15 },
      independence: { archInner: 0.62, archOuter: 0.28, waveAmplitude: 0.3 },
      dynamism: { archBase: 0.35, archAmplitude: 0.35, riseFallBase: 0.3, riseFallAmplitude: 0.45, waveAmplitude: 0.4 }
    },
    motifTexture: { burstDensity: [0.65, 0.9], sparseDensity: [0.25, 0.65], burstIntervalDensity: [0.65, 0.85], sparseIntervalDensity: [0.35, 0.65] },
    motifMutation: { transposeRange: [-5, 5] },
    spatialCanvas: {
      balOffset: [0, 40],
      balStep: 3,
      sideBias: [-18, 18],
      lBalMax: 50,
      ccGroupScale: { source: 0.85, reflection: 1.2, bass: 0.8 },
      ccRangeScale: {
        source: { default: 0.85, 70: 0.8, 71: 0.8, 74: 0.82, 91: 0.9, 92: 0.9, 93: 0.9, 94: 0.88, 95: 0.9 },
        reflection: { default: 1.2, 70: 1.0, 71: 1.0, 74: 1.05, 91: 1.5, 92: 1.5, 93: 1.5, 94: 1.45, 95: 1.5 },
        bass: { default: 0.8, 11: 0.75, 70: 0.75, 71: 0.75, 74: 0.78, 91: 0.72, 92: 0.72, 93: 0.72, 94: 0.7, 95: 0.72 }
      }
    },
    noiseCanvas: { panRange: 50, sustainRange: [0.85, 1.3] },
    rhythmDrift: { burst: [0.4, 1.1], flurry: [0.2, 0.8] }
  },
  rhythmicDrive: {
    emissionGate: { playBase: 0.78, playScale: 0.98, stutterBase: 0.7, stutterScale: 1.4, journeyBoost: 0.07, feedbackBoost: 0.11 },
    feedbackMix: { fx: 0.35, stutter: 0.4, journey: 0.25 },
    intensityBlend: { arc: 0.52, tension: 0.48 },
    stutterGrain: {
      fadeCount: [18, 95],
      fadeDuration: [0.15, 1.0],
      panCount: [40, 125],
      panDuration: [0.08, 0.8],
      fxCount: [45, 140],
      fxDuration: [0.08, 1.3]
    },
    phraseBreath: {
      registerRange: 14,
      densityRange: { min: 0.95, max: 1.45 },
      independence: { archInner: 0.78, archOuter: 0.35, buildResolveInner: 0.9, waveAmplitude: 0.5 },
      dynamism: { archBase: 0.55, archAmplitude: 0.5, riseFallBase: 0.5, riseFallAmplitude: 0.55, buildResolveBase: 0.45, buildResolveSlope: 0.85, waveAmplitude: 0.65 }
    },
    motifTexture: { burstDensity: [0.75, 1.0], sparseDensity: [0.3, 0.75], burstIntervalDensity: [0.75, 1.0], sparseIntervalDensity: [0.4, 0.75] },
    motifMutation: { transposeRange: [-9, 9] },
    spatialCanvas: {
      balOffset: [0, 52],
      balStep: 5,
      sideBias: [-24, 24],
      lBalMax: 62,
      ccGroupScale: { source: 1.15, reflection: 0.95, bass: 1.25 },
      ccRangeScale: {
        source: { default: 1.15, 1: 1.2, 5: 1.2, 11: 1.2, 70: 1.25, 71: 1.25, 74: 1.3, 91: 0.85, 92: 0.85, 93: 0.85, 94: 0.82, 95: 0.85 },
        reflection: { default: 0.95, 91: 0.8, 92: 0.8, 93: 0.8, 94: 0.78, 95: 0.8 },
        bass: { default: 1.25, 11: 1.35, 72: 1.2, 73: 1.2, 74: 1.15, 91: 0.78, 92: 0.78, 93: 0.78, 94: 0.76, 95: 0.78 }
      }
    },
    noiseCanvas: { panRange: 70, sustainRange: [0.75, 1.15] },
    rhythmDrift: { burst: [0.7, 1.8], flurry: [0.4, 1.2] }
  },
  minimal: {
    emissionGate: { playBase: 0.54, playScale: 0.62, stutterBase: 0.48, stutterScale: 0.75, journeyBoost: 0.04, feedbackBoost: 0.03 },
    feedbackMix: { fx: 0.3, stutter: 0.1, journey: 0.6 },
    intensityBlend: { arc: 0.4, tension: 0.6 },
    stutterGrain: {
      fadeCount: [6, 30],
      fadeDuration: [0.6, 2.6],
      panCount: [10, 40],
      panDuration: [0.5, 2.2],
      fxCount: [12, 45],
      fxDuration: [0.5, 2.8]
    },
    phraseBreath: {
      registerRange: 7,
      densityRange: { min: 0.75, max: 1.05 },
      independence: { archInner: 0.45, archOuter: 0.2, riseFallInner: 0.5, riseFallOuter: 0.3, buildResolveInner: 0.55, buildResolveOuter: 0.2, waveBase: 0.25, waveAmplitude: 0.2 },
      dynamism: { archBase: 0.22, archAmplitude: 0.22, riseFallBase: 0.2, riseFallAmplitude: 0.28, buildResolveBase: 0.18, buildResolveSlope: 0.35, buildResolveEnd: 0.12, waveBase: 0.25, waveAmplitude: 0.2 }
    },
    motifTexture: { burstDensity: [0.6, 0.8], sparseDensity: [0.25, 0.55], burstIntervalDensity: [0.6, 0.8], sparseIntervalDensity: [0.3, 0.55] },
    motifMutation: { transposeRange: [-3, 3] },
    spatialCanvas: {
      balOffset: [0, 28],
      balStep: 2,
      sideBias: [-10, 10],
      sideBiasStep: 1,
      lBalMax: 40,
      ccGroupScale: { source: 0.7, reflection: 0.75, bass: 0.7 },
      ccRangeScale: {
        source: { default: 0.7, 70: 0.65, 71: 0.65, 74: 0.68, 91: 0.55, 92: 0.55, 93: 0.55, 94: 0.5, 95: 0.55 },
        reflection: { default: 0.75, 70: 0.7, 71: 0.7, 74: 0.72, 91: 0.62, 92: 0.62, 93: 0.62, 94: 0.58, 95: 0.62 },
        bass: { default: 0.68, 11: 0.65, 70: 0.62, 71: 0.62, 74: 0.64, 91: 0.5, 92: 0.5, 93: 0.5, 94: 0.48, 95: 0.5 }
      }
    },
    noiseCanvas: { panRange: 32, sustainRange: [0.95, 1.05] },
    rhythmDrift: { burst: [0.2, 0.6], flurry: [0.1, 0.4] }
  },
  harmonic: {
    intensityBlend: { arc: 0.35, tension: 0.65 }
  }
});
