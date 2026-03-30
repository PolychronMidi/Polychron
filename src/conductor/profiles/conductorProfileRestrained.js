conductorProfileRestrained = () => ({
  label: 'Restrained',
  density: {
    floor: 0.20,
    ceiling: 0.48,
    range: [0.25, 0.42],
    smoothing: 0.94
  },
  phaseMultipliers: {
    intro: 0.65,
    opening: 0.65,
    exposition: 0.75,
    development: 0.80,
    climax: 0.90,
    resolution: 0.65,
    conclusion: 0.60,
    coda: 0.55
  },
  arcMapping: {
    intro: 'arch',
    opening: 'arch',
    exposition: 'arch',
    development: 'rise-fall',
    climax: 'rise-fall',
    resolution: 'arch',
    conclusion: 'arch',
    coda: 'arch'
  },
  stutter: {
    rateTiers: [
      { threshold: 0, rate: 4 },
      { threshold: 0.6, rate: 8 },
      { threshold: 0.9, rate: 16 }
    ],
    coherenceFlip: 0.9,
    rateCurveFlip: 0.75
  },
  energyWeights: {
    phrase: 0.3,
    journey: 0.4,
    feedback: 0.15,
    pulse: 0.15
  },
  flicker: {
    depthScale: 0.3,
    crossModWeight: 0.2
  },
  climaxBoost: {
    playScale: 1.0,
    stutterScale: 1.0
  },
  crossMod: {
    rangeScale: 0.5,
    penaltyScale: 0.6,
    textureBoostScale: 0.35
  },
  fxMix: {
    reverbScale: 0.5,
    filterOpenness: 0.55,
    delayScale: 0.3,
    textureBoostScale: 0.3
  },
  texture: {
    burstBaseScale: 0.35,
    flurryBaseScale: 0.3,
    burstCap: 0.07,
    flurryCap: 0.05
  },
  attenuation: {
    subsubdivRange: [1, 2],
    subdivRange: [1.5, 3],
    divRange: [1.5, 3.5]
  },
  voiceSpread: {
    spread: 0.08,
    chordBurstInnerBoost: 0.6,
    flurryDecayRate: 1.2,
    jitterAmount: 0.05
  },
  familyWeights: {
    diatonicCore: 1.3,
    harmonicMotion: 1.0,
    development: 0.6,
    tonalExploration: 1.2,
    rhythmicDrive: 0.5
  },
  journeyBoldness: 0.4,
  emission: {
    noiseProfile: 'subtle',
    sourceNoiseInfluence: 0.06,
    reflectionNoiseInfluence: 0.05,
    bassNoiseInfluence: 0.04,
    voiceConfigBlend: 0.4
  }
});
