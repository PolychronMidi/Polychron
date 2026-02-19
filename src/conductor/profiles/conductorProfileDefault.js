conductorProfileDefault = () => ({
  label: 'Default',
  density: {
    floor: 0.15,
    ceiling: 0.95,
    range: [0.3, 0.8],
    smoothing: 0.8
  },
  phaseMultipliers: {
    intro: 0.8,
    opening: 0.8,
    exposition: 1.0,
    development: 1.0,
    climax: 1.3,
    resolution: 0.7,
    conclusion: 0.7,
    coda: 0.7
  },
  arcMapping: {
    intro: 'arch',
    opening: 'arch',
    exposition: 'rise-fall',
    development: 'wave',
    climax: 'build-resolve',
    resolution: 'rise-fall',
    conclusion: 'rise-fall',
    coda: 'arch'
  },
  stutter: {
    rateTiers: [
      { threshold: 0, rate: 8 },
      { threshold: 0.5, rate: 16 },
      { threshold: 0.8, rate: 32 }
    ],
    coherenceFlip: 0.8,
    rateCurveFlip: 0.6
  },
  energyWeights: {
    phrase: 0.4,
    journey: 0.25,
    feedback: 0.2,
    pulse: 0.15
  },
  flicker: {
    depthScale: 1.0,
    crossModWeight: 0.5
  },
  climaxBoost: {
    playScale: 1.1,
    stutterScale: 1.2
  },
  crossMod: {
    rangeScale: 1.0,
    penaltyScale: 1.0,
    textureBoostScale: 1.0
  },
  fxMix: {
    reverbScale: 1.0,
    filterOpenness: 1.0,
    delayScale: 1.0,
    textureBoostScale: 1.0
  },
  texture: {
    burstBaseScale: 1.0,
    flurryBaseScale: 1.0,
    burstCap: 0.18,
    flurryCap: 0.15
  },
  attenuation: {
    subsubdivRange: [1.5, 3],
    subdivRange: [2, 4],
    divRange: [2, 5]
  },
  voiceSpread: {
    spread: 0.15,
    chordBurstInnerBoost: 1.0,
    flurryDecayRate: 1.8,
    jitterAmount: 0.1
  },
  familyWeights: {
    diatonicCore: 1.0,
    harmonicMotion: 1.0,
    development: 1.0,
    tonalExploration: 1.0,
    rhythmicDrive: 1.0
  },
  journeyBoldness: 1.0,
  emission: {
    noiseProfile: 'subtle',
    sourceNoiseInfluence: 0.12,
    reflectionNoiseInfluence: 0.10,
    bassNoiseInfluence: 0.08,
    voiceConfigBlend: 0.3
  }
});
