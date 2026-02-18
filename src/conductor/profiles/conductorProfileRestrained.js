conductorProfileRestrained = () => ({
  label: 'Restrained',
  density: {
    floor: 0.3,
    ceiling: 0.65,
    range: [0.4, 0.6],
    smoothing: 0.92
  },
  phaseMultipliers: {
    intro: 0.85,
    opening: 0.85,
    exposition: 0.95,
    development: 1.0,
    climax: 1.1,
    resolution: 0.8,
    conclusion: 0.8,
    coda: 0.75
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
    depthScale: 0.5,
    crossModWeight: 0.3
  },
  climaxBoost: {
    playScale: 1.05,
    stutterScale: 1.05
  },
  crossMod: {
    rangeScale: 0.6,
    penaltyScale: 0.7,
    textureBoostScale: 0.5
  },
  fxMix: {
    reverbScale: 0.6,
    filterOpenness: 0.7,
    delayScale: 0.4,
    textureBoostScale: 0.4
  },
  texture: {
    burstBaseScale: 0.5,
    flurryBaseScale: 0.4,
    burstCap: 0.10,
    flurryCap: 0.08
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
