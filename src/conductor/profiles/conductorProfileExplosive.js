conductorProfileExplosive = () => ({
  label: 'Explosive',
  density: {
    floor: 0.1,
    ceiling: 0.98,
    range: [0.15, 0.95],
    smoothing: 0.5
  },
  phaseMultipliers: {
    intro: 0.6,
    opening: 0.7,
    exposition: 1.0,
    development: 1.15,
    climax: 1.5,
    resolution: 0.55,
    conclusion: 0.5,
    coda: 0.4
  },
  arcMapping: {
    intro: 'rise-fall',
    opening: 'wave',
    exposition: 'wave',
    development: 'build-resolve',
    climax: 'build-resolve',
    resolution: 'rise-fall',
    conclusion: 'rise-fall',
    coda: 'arch'
  },
  stutter: {
    rateTiers: [
      { threshold: 0, rate: 16 },
      { threshold: 0.4, rate: 32 },
      { threshold: 0.7, rate: 64 }
    ],
    coherenceFlip: 0.6,
    rateCurveFlip: 0.4
  },
  energyWeights: {
    phrase: 0.25,
    journey: 0.2,
    feedback: 0.35,
    pulse: 0.2
  },
  flicker: {
    depthScale: 1.8,
    crossModWeight: 0.8
  },
  climaxBoost: {
    playScale: 1.2,
    stutterScale: 1.4
  },
  crossMod: {
    rangeScale: 1.6,
    penaltyScale: 1.4,
    textureBoostScale: 1.8
  },
  fxMix: {
    reverbScale: 1.6,
    filterOpenness: 1.4,
    delayScale: 1.8,
    textureBoostScale: 2.0
  },
  texture: {
    burstBaseScale: 1.8,
    flurryBaseScale: 1.6,
    burstCap: 0.28,
    flurryCap: 0.25
  },
  attenuation: {
    subsubdivRange: [2, 4],
    subdivRange: [3, 6],
    divRange: [3, 7]
  },
  voiceSpread: {
    spread: 0.25,
    chordBurstInnerBoost: 1.6,
    flurryDecayRate: 2.5,
    jitterAmount: 0.18
  },
  familyWeights: {
    diatonicCore: 0.7,
    harmonicMotion: 1.3,
    development: 1.5,
    tonalExploration: 0.8,
    rhythmicDrive: 1.6
  },
  // R69 E2: Phase variance gate. Without this, explosive defaults to 1.0
  // (no gating), letting 92% of phase variance events through and starving
  // the phase axis of energy. 0.20 matches the aggressive character while
  // still providing meaningful gating (atmospheric uses 0.15).
  phaseVarianceGateScale: 0.20,
  journeyBoldness: 1.8,
  emission: {
    noiseProfile: 'dramatic',
    sourceNoiseInfluence: 0.20,
    reflectionNoiseInfluence: 0.16,
    bassNoiseInfluence: 0.14,
    voiceConfigBlend: 0.2
  }
});
