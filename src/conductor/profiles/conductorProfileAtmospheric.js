conductorProfileAtmospheric = () => ({
  label: 'Atmospheric',
  density: {
    floor: 0.1,
    ceiling: 0.55,
    range: [0.2, 0.5],
    smoothing: 0.95
  },
  phaseMultipliers: {
    intro: 0.9,
    opening: 0.9,
    exposition: 1.0,
    development: 1.0,
    climax: 1.15,
    resolution: 0.85,
    conclusion: 0.85,
    coda: 0.8
  },
  arcMapping: {
    intro: 'arch',
    opening: 'arch',
    exposition: 'wave',
    development: 'wave',
    climax: 'rise-fall',
    resolution: 'rise-fall',
    conclusion: 'arch',
    coda: 'arch'
  },
  stutter: {
    rateTiers: [
      { threshold: 0, rate: 4 },
      { threshold: 0.7, rate: 8 },
      { threshold: 0.95, rate: 16 }
    ],
    coherenceFlip: 0.95,
    rateCurveFlip: 0.85
  },
  energyWeights: {
    phrase: 0.55,
    journey: 0.2,
    feedback: 0.1,
    pulse: 0.15
  },
  flicker: {
    depthScale: 0.3,
    crossModWeight: 0.2
  },
  climaxBoost: {
    playScale: 1.05,
    stutterScale: 1.0
  },
  crossMod: {
    rangeScale: 0.8,
    penaltyScale: 0.8,
    textureBoostScale: 0.6
  },
  fxMix: {
    reverbScale: 1.4,
    filterOpenness: 0.8,
    delayScale: 1.5,
    textureBoostScale: 1.2
  },
  texture: {
    burstBaseScale: 0.6,
    flurryBaseScale: 1.2,
    burstCap: 0.12,
    flurryCap: 0.18
  },
  attenuation: {
    subsubdivRange: [1.2, 2.5],
    subdivRange: [1.5, 3],
    divRange: [2, 4]
  },
  voiceSpread: {
    spread: 0.12,
    chordBurstInnerBoost: 0.8,
    flurryDecayRate: 1.5,
    jitterAmount: 0.08
  },
  familyWeights: {
    diatonicCore: 1.2,
    harmonicMotion: 0.8,
    development: 0.7,
    tonalExploration: 1.5,
    rhythmicDrive: 0.4
  },
  journeyBoldness: 0.6,
  emission: {
    noiseProfile: 'micro',
    sourceNoiseInfluence: 0.14,
    reflectionNoiseInfluence: 0.12,
    bassNoiseInfluence: 0.10,
    voiceConfigBlend: 0.35
  }
});
