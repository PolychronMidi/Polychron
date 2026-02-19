conductorProfileRhythmicDrive = () => ({
  label: 'Rhythmic Drive',
  density: {
    floor: 0.35,
    ceiling: 0.9,
    range: [0.4, 0.85],
    smoothing: 0.65
  },
  phaseMultipliers: {
    intro: 0.75,
    opening: 0.85,
    exposition: 1.05,
    development: 1.1,
    climax: 1.35,
    resolution: 0.65,
    conclusion: 0.6,
    coda: 0.55
  },
  arcMapping: {
    intro: 'rise-fall',
    opening: 'rise-fall',
    exposition: 'build-resolve',
    development: 'build-resolve',
    climax: 'build-resolve',
    resolution: 'rise-fall',
    conclusion: 'arch',
    coda: 'arch'
  },
  stutter: {
    rateTiers: [
      { threshold: 0, rate: 16 },
      { threshold: 0.35, rate: 32 },
      { threshold: 0.65, rate: 64 }
    ],
    coherenceFlip: 0.7,
    rateCurveFlip: 0.5
  },
  energyWeights: {
    phrase: 0.2,
    journey: 0.2,
    feedback: 0.25,
    pulse: 0.35
  },
  flicker: {
    depthScale: 1.4,
    crossModWeight: 0.7
  },
  climaxBoost: {
    playScale: 1.15,
    stutterScale: 1.3
  },
  crossMod: {
    rangeScale: 1.3,
    penaltyScale: 1.5,
    textureBoostScale: 1.5
  },
  fxMix: {
    reverbScale: 0.8,
    filterOpenness: 1.2,
    delayScale: 0.6,
    textureBoostScale: 1.0
  },
  texture: {
    burstBaseScale: 1.4,
    flurryBaseScale: 0.8,
    burstCap: 0.22,
    flurryCap: 0.10
  },
  attenuation: {
    subsubdivRange: [2, 3.5],
    subdivRange: [2.5, 5],
    divRange: [2.5, 6]
  },
  voiceSpread: {
    spread: 0.20,
    chordBurstInnerBoost: 1.3,
    flurryDecayRate: 2.0,
    jitterAmount: 0.14
  },
  familyWeights: {
    diatonicCore: 0.8,
    harmonicMotion: 1.2,
    development: 1.0,
    tonalExploration: 0.6,
    rhythmicDrive: 1.8
  },
  journeyBoldness: 1.3,
  emission: {
    noiseProfile: 'subtle',
    sourceNoiseInfluence: 0.16,
    reflectionNoiseInfluence: 0.12,
    bassNoiseInfluence: 0.10,
    voiceConfigBlend: 0.25
  }
});
