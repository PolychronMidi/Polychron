conductorProfileMinimal = () => ({
  label: 'Minimal',
  density: {
    floor: 0.25,
    ceiling: 0.5,
    range: [0.3, 0.45],
    smoothing: 0.96
  },
  phaseMultipliers: {
    intro: 0.95,
    opening: 0.95,
    exposition: 1.0,
    development: 1.0,
    climax: 1.05,
    resolution: 0.95,
    conclusion: 0.95,
    coda: 0.9
  },
  arcMapping: {
    intro: 'arch',
    opening: 'arch',
    exposition: 'arch',
    development: 'arch',
    climax: 'rise-fall',
    resolution: 'arch',
    conclusion: 'arch',
    coda: 'arch'
  },
  stutter: {
    rateTiers: [
      { threshold: 0, rate: 4 },
      { threshold: 0.8, rate: 8 },
      { threshold: 0.95, rate: 12 }
    ],
    coherenceFlip: 0.98,
    rateCurveFlip: 0.95
  },
  energyWeights: {
    phrase: 0.5,
    journey: 0.25,
    feedback: 0.1,
    pulse: 0.15
  },
  flicker: {
    depthScale: 0.0,
    crossModWeight: 0.0
  },
  climaxBoost: {
    playScale: 1.02,
    stutterScale: 1.0
  },
  crossMod: {
    rangeScale: 0.4,
    penaltyScale: 0.5,
    textureBoostScale: 0.2
  },
  fxMix: {
    reverbScale: 0.5,
    filterOpenness: 0.6,
    delayScale: 0.3,
    textureBoostScale: 0.2
  },
  texture: {
    burstBaseScale: 0.3,
    flurryBaseScale: 0.2,
    burstCap: 0.06,
    flurryCap: 0.05
  },
  attenuation: {
    subsubdivRange: [1, 1.8],
    subdivRange: [1, 2.5],
    divRange: [1.5, 3]
  },
  voiceSpread: {
    spread: 0.06,
    chordBurstInnerBoost: 0.4,
    flurryDecayRate: 1.0,
    jitterAmount: 0.04
  },
  familyWeights: {
    diatonicCore: 1.6,
    harmonicMotion: 0.7,
    development: 0.5,
    tonalExploration: 0.8,
    rhythmicDrive: 0.4
  },
  journeyBoldness: 0.2,
  emission: {
    noiseProfile: 'micro',
    sourceNoiseInfluence: 0.04,
    reflectionNoiseInfluence: 0.03,
    bassNoiseInfluence: 0.02,
    voiceConfigBlend: 0.5
  }
});
